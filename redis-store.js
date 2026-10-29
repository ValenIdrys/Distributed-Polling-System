
const { createClient } = require("redis");

const redis = createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379"
});

redis.on("error", error => {
    console.error("Redis error:", error.message);
});

const POLL_LATEST_KEY = "poll:latest";
const POLL_ACTIVE_KEY = "poll:active";
const POLL_COUNTER_KEY = "poll:counter";
const POLL_EVENTS_CHANNEL = "poll:events";

async function connectRedis() {
    if (!redis.isOpen) {
        await redis.connect();
    }
}

async function getLatestPoll() {
    const value = await redis.get(POLL_LATEST_KEY);
    return value ? JSON.parse(value) : null;
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
    POLL_EVENTS_CHANNEL
};
