
const { createClient } = require("redis");

const redis = createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

const subscriber = redis.duplicate();

subscriber.on("error", error => {
    console.error("Redis subscriber error:", error.message);
});

redis.on("error", error => {
    console.error("Redis error:", error.message);
});

const POLL_LATEST_KEY = "poll:latest";
const POLL_ACTIVE_KEY = "poll:active";
const POLL_COUNTER_KEY = "poll:counter";
const POLL_EVENTS_CHANNEL = "poll:events";
const USER_SESSIONS_KEY = "users:sessions";
const USERNAMES_KEY = "users:usernames";
const USER_SESSIONS_EXPIRY_KEY = "users:expiry";
const USER_EVENTS_CHANNEL = "users:events";

const SESSION_TIMEOUT = 60 * 1000;

async function connectRedis() {
    if (!redis.isOpen) {
        await redis.connect();
    }
}

async function getLatestPoll() {
    const value = await redis.get(POLL_LATEST_KEY);

    if (!value) return null;

    const poll = JSON.parse(value);

    if (!Array.isArray(poll.votes)) {
        poll.votes = Object.values(poll.votes || {});
    }

    return poll;
}

async function getActivePoll() {
    const pollId = await redis.get(POLL_ACTIVE_KEY);

    if (!pollId) {
        return null;
    }

    const poll = await getLatestPoll();

    if (!poll || String(poll.id) !== pollId) {
        return null;
    }

    return poll.status === "open" ? poll : null;
}

async function savePoll(poll) {
    await redis.set(POLL_LATEST_KEY, JSON.stringify(poll));

    if (poll.status === "open") {
        await redis.set(POLL_ACTIVE_KEY, String(poll.id));
    } else {
        await redis.del(POLL_ACTIVE_KEY);
    }
}

async function nextPollId() {
    return redis.incr(POLL_COUNTER_KEY);
}


async function createPollAtomic(question, options) {
    const pollId = await nextPollId();

    const poll = {
        id: pollId,
        question,
        options,
        status: "open",
        votes: []
    };

    const script = `
        if redis.call("GET", KEYS[1]) then
            return {0, "POLL_ALREADY_ACTIVE"}
        end

        redis.call("SET", KEYS[1], ARGV[1])
        redis.call("SET", KEYS[2], ARGV[2])

        return {1, "OK"}
    `;

    const result = await redis.eval(script, {
        keys: [
            POLL_ACTIVE_KEY,
            POLL_LATEST_KEY
        ],
        arguments: [
            String(pollId),
            JSON.stringify(poll)
        ]
    });

    if (Number(result[0]) !== 1) {
        return {
            success: false,
            reason: result[1]
        };
    }

    return {
        success: true,
        poll
    };
}

async function closePollAtomic(pollId) {
    const script = `
        local raw = redis.call("GET", KEYS[1])

        if not raw then
            return {0, "NO_POLL"}
        end

        local poll = cjson.decode(raw)

        if tostring(poll.id) ~= ARGV[1] then
            return {0, "POLL_CHANGED"}
        end

        local activePollId = redis.call("GET", KEYS[2])

        if not activePollId or activePollId ~= ARGV[1] then
            return {0, "POLL_NOT_ACTIVE"}
        end

        poll.status = "closed"

        redis.call("SET", KEYS[1], cjson.encode(poll))
        redis.call("DEL", KEYS[2])

        return {1, "OK"}
    `;

    const result = await redis.eval(script, {
        keys: [
            POLL_LATEST_KEY,
            POLL_ACTIVE_KEY
        ],
        arguments: [String(pollId)]
    });

    return {
        success: Number(result[0]) === 1,
        reason: result[1]
    };
}


async function recordVote(pollId, username, optionIndex) {
    const script = `
        local raw = redis.call("GET", KEYS[1])

        if not raw then
            return {0, "NO_POLL"}
        end

        local poll = cjson.decode(raw)

       if tostring(poll.id) ~= ARGV[1] then
            return {0, "POLL_CHANGED"}
        end

        local activePollId = redis.call("GET", KEYS[3])

        if not activePollId or activePollId ~= ARGV[1] then
            return {0, "POLL_CLOSED"}
        end

        if poll.status ~= "open" then
            return {0, "POLL_CLOSED"}
        end

        local index = tonumber(ARGV[3])

        if not index or index < 0 or index >= #poll.options then
            return {0, "INVALID_OPTION"}
        end

        local voterKey = KEYS[2]
        local voter = string.lower(ARGV[2])

        if redis.call("SISMEMBER", voterKey, voter) == 1 then
            return {0, "ALREADY_VOTED"}
        end

        redis.call("SADD", voterKey, voter)

        table.insert(poll.votes, {
            username = ARGV[2],
            optionIndex = index,
            timestamp = ARGV[4]
        })

        redis.call("SET", KEYS[1], cjson.encode(poll))

        return {1, "OK"}
    `;

    const result = await redis.eval(script, {
        keys: [
            POLL_LATEST_KEY,
            `poll:voters:${pollId}`,
            POLL_ACTIVE_KEY
        ],
        arguments: [
            String(pollId),
            username,
            String(optionIndex),
            new Date().toISOString()
        ]
    });

    return {
        success: Number(result[0]) === 1,
        reason: result[1]
    };
}

async function registerUserSession(sessionId, user) {
    const script = `
        local username = string.lower(ARGV[1])
        local existingSession = redis.call("HGET", KEYS[2], username)

        if existingSession then
            local expiry = redis.call("ZSCORE", KEYS[3], existingSession)

            if expiry and tonumber(expiry) > tonumber(ARGV[4]) then
                return {0, "USERNAME_TAKEN"}
            end

            redis.call("HDEL", KEYS[1], existingSession)
            redis.call("ZREM", KEYS[3], existingSession)
            redis.call("HDEL", KEYS[2], username)
        end

        redis.call("HSET", KEYS[1], ARGV[2], ARGV[3])
        redis.call("HSET", KEYS[2], username, ARGV[2])
        redis.call("ZADD", KEYS[3], ARGV[4] + ARGV[5], ARGV[2])

        return {1, "OK"}
    `;

    const now = Date.now();

    const result = await redis.eval(script, {
        keys: [
            USER_SESSIONS_KEY,
            USERNAMES_KEY,
            USER_SESSIONS_EXPIRY_KEY
        ],
        arguments: [
            user.username,
            sessionId,
            JSON.stringify(user),
            String(now),
            String(SESSION_TIMEOUT)
        ]
    });

    if (Number(result[0]) === 1) {
        await publishUserUpdate();
    }

    return {
        success: Number(result[0]) === 1,
        reason: result[1]
    };
}

async function refreshUserSession(sessionId) {
    const script = `
        if redis.call("HEXISTS", KEYS[1], ARGV[1]) == 0 then
            return 0
        end

        redis.call("ZADD", KEYS[2], ARGV[2] + ARGV[3], ARGV[1])
        return 1
    `;

    return Number(await redis.eval(script, {
        keys: [
            USER_SESSIONS_KEY,
            USER_SESSIONS_EXPIRY_KEY
        ],
        arguments: [
            sessionId,
            String(Date.now()),
            String(SESSION_TIMEOUT)
        ]
    })) === 1;
}

async function resumeUserSession(sessionId, server, port) {
    const script = `
        local raw = redis.call("HGET", KEYS[1], ARGV[1])

        if not raw then
            return {0, "SESSION_NOT_FOUND"}
        end

        local expiry = redis.call("ZSCORE", KEYS[3], ARGV[1])

        if not expiry or tonumber(expiry) <= tonumber(ARGV[2]) then
            return {0, "SESSION_EXPIRED"}
        end

        local user = cjson.decode(raw)

        local username = string.lower(user.username)
        local currentSession = redis.call("HGET", KEYS[2], username)

        if currentSession ~= ARGV[1] then
            return {0, "SESSION_INVALID"}
        end

        user.server = ARGV[3]
        user.port = tonumber(ARGV[4])
        user.connected = true

        redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(user))
        redis.call("ZADD", KEYS[3], ARGV[2] + ARGV[5], ARGV[1])

        return {1, cjson.encode(user)}
    `;

    const result = await redis.eval(script, {
        keys: [
            USER_SESSIONS_KEY,
            USERNAMES_KEY,
            USER_SESSIONS_EXPIRY_KEY
        ],
        arguments: [
            sessionId,
            String(Date.now()),
            server,
            String(port),
            String(SESSION_TIMEOUT)
        ]
    });

    if (Number(result[0]) !== 1) {
        return {
            success: false,
            reason: result[1]
        };
    }

    await publishUserUpdate();

    return {
        success: true,
        user: JSON.parse(result[1])
    };
}

async function markUserDisconnected(sessionId, username) {
    const script = `
        local raw = redis.call("HGET", KEYS[1], ARGV[1])

        if not raw then
            return 0
        end

        local currentSession = redis.call(
            "HGET",
            KEYS[2],
            string.lower(ARGV[2])
        )

        if currentSession ~= ARGV[1] then
            return 0
        end

        local user = cjson.decode(raw)
        user.connected = false

        redis.call("HSET", KEYS[1], ARGV[1], cjson.encode(user))

        return 1
    `;

    const result = await redis.eval(script, {
        keys: [
            USER_SESSIONS_KEY,
            USERNAMES_KEY
        ],
        arguments: [
            sessionId,
            username
        ]
    });

    if (Number(result) === 1) {
        await publishUserUpdate();
        return true;
    }

    return false;
}

async function removeUserSession(sessionId, username) {
    const script = `
        local currentSession = redis.call("HGET", KEYS[2], string.lower(ARGV[2]))

        if currentSession ~= ARGV[1] then
            return 0
        end

        redis.call("HDEL", KEYS[1], ARGV[1])
        redis.call("HDEL", KEYS[2], string.lower(ARGV[2]))
        redis.call("ZREM", KEYS[3], ARGV[1])

        return 1
    `;

    const removed = Number(await redis.eval(script, {
        keys: [
            USER_SESSIONS_KEY,
            USERNAMES_KEY,
            USER_SESSIONS_EXPIRY_KEY
        ],
        arguments: [sessionId, username]
    })) === 1;

    if (removed) {
        await publishUserUpdate();
    }

    return removed;
}

async function cleanupExpiredSessions() {
    const script = `
        local expired = redis.call(
            "ZRANGEBYSCORE",
            KEYS[3],
            "-inf",
            ARGV[1]
        )

        for _, sessionId in ipairs(expired) do
            local raw = redis.call("HGET", KEYS[1], sessionId)

            if raw then
                local user = cjson.decode(raw)
                local username = string.lower(user.username)

                local currentSession = redis.call(
                    "HGET",
                    KEYS[2],
                    username
                )

                if currentSession == sessionId then
                    redis.call("HDEL", KEYS[2], username)
                end

                redis.call("HDEL", KEYS[1], sessionId)
            end

            redis.call("ZREM", KEYS[3], sessionId)
        end

        return #expired
    `;

    const removed = Number(await redis.eval(script, {
        keys: [
            USER_SESSIONS_KEY,
            USERNAMES_KEY,
            USER_SESSIONS_EXPIRY_KEY
        ],
        arguments: [String(Date.now())]
    }));

    if (removed > 0) {
        await publishUserUpdate();
    }

    return removed;
}

async function getConnectedUsers() {
    await cleanupExpiredSessions();

    const sessions = await redis.hGetAll(USER_SESSIONS_KEY);

    return Object.values(sessions)
        .map(session => JSON.parse(session))
        .filter(user => user.connected !== false);
}

async function publishUserUpdate() {
    await redis.publish(USER_EVENTS_CHANNEL, "usersUpdate");
}

async function subscribeUserUpdates(callback) {
    if (!subscriber.isOpen) {
        await subscriber.connect();
    }

    await subscriber.subscribe(USER_EVENTS_CHANNEL, message => {
        callback(message);
    });
}

async function subscribePollUpdates(callback) {
    if (!subscriber.isOpen) {
        await subscriber.connect();
    }

    await subscriber.subscribe(POLL_EVENTS_CHANNEL, message => {
        callback(message);
    });
}

async function publishPollUpdate() {
    await redis.publish(POLL_EVENTS_CHANNEL, "pollUpdate");
}

module.exports = {
    redis,
    connectRedis,
    getLatestPoll,
    getActivePoll,
    savePoll,
    nextPollId,
    createPollAtomic,
    closePollAtomic,
    recordVote,
    publishPollUpdate,
    subscribePollUpdates,
    registerUserSession,
    refreshUserSession,
    resumeUserSession,
    markUserDisconnected,
    removeUserSession,
    cleanupExpiredSessions,
    getConnectedUsers,
    publishUserUpdate,
    subscribeUserUpdates,
    POLL_EVENTS_CHANNEL
};
