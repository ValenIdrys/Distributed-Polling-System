
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const store = require("./redis-store");
const { randomUUID } = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

const PASSWORDS = {
    lecturer: "lecturer123",
    student: "student123"
};

const users = new Map();


app.use(express.static("public"));

function sendMessage(socket, data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function broadcast(data) {
    for (const client of wss.clients) {
        sendMessage(client, data);
    }
}

async function broadcastUsers() {
    try {
        const connectedUsers = await store.getConnectedUsers();

        broadcast({
            type: "users",
            users: connectedUsers
        });
    } catch (error) {
        console.error("Failed to retrieve connected users:", error.message);
    }
}

function getPollState(poll) {
    if (!poll) return null;

    const counts = poll.options.map((option, index) => ({
        option,
        index,
        votes: poll.votes.filter(
            vote => vote.optionIndex === index
        ).length
    }));

    return {
        id: poll.id,
        question: poll.question,
        options: poll.options,
        status: poll.status,
        counts,
        totalVotes: poll.votes.length,
        votes: poll.votes.map(vote => ({
            username: vote.username,
            option: poll.options[vote.optionIndex],
            timestamp: vote.timestamp
        }))
    };
}

async function broadcastPoll() {
    try {
        const poll = await store.getLatestPoll();

        broadcast({
            type: "pollUpdate",
            poll: getPollState(poll)
        });
    } catch (error) {
        console.error("Failed to broadcast poll:", error.message);
    }
}

function reject(socket, message) {
    sendMessage(socket, {
        type: "error",
        message
    });
}

wss.on("connection", socket => {
    console.log("A client connected to Server 1");

    sendMessage(socket, {
        type: "welcome",
        message: "Connected to Server 1!",
        server: "Server 1",
        port: PORT
    });

    // Send the current state to a newly connected client.
    store.getConnectedUsers()
    .then(connectedUsers => {
        sendMessage(socket, {
            type: "users",
            users: connectedUsers
        });
    })
    .catch(error => {
        console.error("Failed to load connected users:", error.message);
    });

    store.getLatestPoll()
    .then(poll => {
        sendMessage(socket, {
            type: "pollUpdate",
            poll: getPollState(poll)
        });
    })
    .catch(error => {
        console.error("Failed to load poll for new client:", error.message);
    });

    socket.on("message", async rawData => {
        let data;

        try {
            data = JSON.parse(rawData.toString());
        } catch {
            reject(socket, "Invalid message format.");
            return;
        }

        if (!data || typeof data.type !== "string") {
            reject(socket, "Invalid request.");
            return;
        }

        if (data.type === "resumeSession") {
    const sessionId = data.sessionId;

    if (typeof sessionId !== "string" || !sessionId) {
        reject(socket, "Invalid session token.");
        return;
    }

    try {
        const result = await store.resumeUserSession(
            sessionId,
            SERVER_NAME,
            PORT
        );

        if (!result.success) {
            reject(socket, "Session expired. Please log in again.");
            return;
        }

        const user = result.user;

        users.set(socket, user);
        socket.sessionId = sessionId;

        socket.sessionRefreshInterval = setInterval(async () => {
            try {
                await store.refreshUserSession(sessionId);
            } catch (error) {
                console.error("Failed to refresh session:", error.message);
            }
        }, 20000);

        sendMessage(socket, {
            type: "loginSuccess",
            user,
            sessionId
        });

        console.log(`${user.username} resumed on ${SERVER_NAME}`);
        await broadcastUsers();
    } catch (error) {
        console.error("Session recovery failed:", error.message);
        reject(socket, "Could not restore your session.");
    }

    return;
}


        if (data.type === "login") {
            const username =
                typeof data.username === "string"
                    ? data.username.trim()
                    : "";

            const role = data.role;
            const password = data.password;

            if (!username || username.length > 30) {
                reject(socket, "Enter a username of 1–30 characters.");
                return;
            }

            if (!Object.hasOwn(PASSWORDS, role)) {
                reject(socket, "Select a valid role.");
                return;
            }

            if (role === "lecturer" && password !== PASSWORDS.lecturer) {
    reject(socket, "Incorrect lecturer password.");
    return;
}

            const user = {
    username,
    role,
    server: "Server 1",
    port: PORT
};

    const sessionId = randomUUID();

    try {
        const result = await store.registerUserSession(
            sessionId,
            user
        );

        if (!result.success) {
            reject(socket, "That username is already connected.");
            return;
        }

        users.set(socket, user);
        socket.sessionId = sessionId;
        socket.sessionRefreshInterval = setInterval(async () => {
    try {
        const refreshed = await store.refreshUserSession(sessionId);

        if (!refreshed) {
            console.warn(`Session expired for ${username}`);
        }
    } catch (error) {
        console.error("Failed to refresh session:", error.message);
    }
}, 20000);

    } catch (error) {
        console.error("Failed to register user session:", error.message);
        reject(socket, "Login failed. Please try again.");
        return;
    }

            sendMessage(socket, {
                type: "loginSuccess",
                user,
                sessionId
            });

            console.log(`${username} logged in as ${role}`);
            broadcastUsers();
            return;
        }
        
        if (data.type === "logout") {
    const user = users.get(socket);

    if (user && socket.sessionId) {
        try {
            await store.removeUserSession(
                socket.sessionId,
                user.username
            );

            console.log(`${user.username} logged out intentionally.`);
        } catch (error) {
            console.error("Logout failed:", error.message);
        }

        if (socket.sessionRefreshInterval) {
            clearInterval(socket.sessionRefreshInterval);
        }

        users.delete(socket);
        socket.intentionalLogout = true;

        await broadcastUsers();
    }

    socket.close();
    return;
}

        const user = users.get(socket);

        if (!user) {
            reject(socket, "Please log in first.");
            return;
        }

        if (data.type === "createPoll") {
            if (user.role !== "lecturer") {
                reject(socket, "Only lecturers can create polls.");
                return;
            }


            const question =
                typeof data.question === "string"
                    ? data.question.trim()
                    : "";

            const options = Array.isArray(data.options)
                ? data.options.map(option =>
                    typeof option === "string" ? option.trim() : ""
                )
                : [];

            if (!question || question.length > 200) {
                reject(socket, "Enter a question of 1–200 characters.");
                return;
            }

            if (
                options.length < 2 ||
                options.length > 6 ||
                options.some(option => !option || option.length > 100) ||
                new Set(options.map(option => option.toLowerCase())).size
                    !== options.length
            ) {
                reject(
                    socket,
                    "Provide 2–6 non-empty, unique answer options."
                );
                return;
            }

            
            try {
                const result = await store.createPollAtomic(question, options);

                if (!result.success) {
                    reject(
                        socket,
                        result.reason === "POLL_ALREADY_ACTIVE"
                            ? "Close the current poll before creating another."
                            : "Failed to create the poll."
                    );
                    return;
                }

    console.log(`Poll ${result.poll.id} launched: ${question}`);

    await store.publishPollUpdate();
    await broadcastPoll();
    return;
} catch (error) {
    console.error("Failed to create poll:", error.message);
    reject(socket, "Failed to create the poll. Please try again.");
    return;
}

        }

       
        if (data.type === "vote") {
            if (user.role !== "student") {
                reject(socket, "Only students can vote.");
                return;
            }

            const poll = await store.getActivePoll();

            if (!poll) {
                reject(socket, "There is no open poll.");
                return;
            }

            const optionIndex = data.optionIndex;

            if (
                !Number.isInteger(optionIndex) ||
                optionIndex < 0 ||
                optionIndex >= poll.options.length
            ) {
                reject(socket, "Select a valid answer.");
                return;
            }

            try {
                const result = await store.recordVote(
                    poll.id,
                    user.username,
                    optionIndex
                );

                if (!result.success) {
                    const messages = {
                        ALREADY_VOTED: "You have already voted in this poll.",
                        POLL_CLOSED: "This poll is closed.",
                        POLL_CHANGED: "The poll has changed. Please refresh.",
                        NO_POLL: "There is no available poll.",
                        INVALID_OPTION: "Select a valid answer."
                    };

                    reject(
                        socket,
                        messages[result.reason] || "Failed to submit your vote."
                    );
                    return;
                }

                sendMessage(socket, {
                    type: "voteConfirmation",
                    message: "Your vote has been submitted."
                });

                console.log(`${user.username} submitted a vote.`);

                await store.publishPollUpdate();
                await broadcastPoll();
                return;
            } catch (error) {
                console.error("Failed to record vote:", error.message);
                reject(socket, "Failed to submit your vote. Please try again.");
                return;
            }
        }


        
        if (data.type === "closePoll") {
            if (user.role !== "lecturer") {
                reject(socket, "Only lecturers can close polls.");
                return;
            }

            try {
                const poll = await store.getActivePoll();

                if (!poll) {
                    reject(socket, "There is no open poll to close.");
                    return;
                }

                const result = await store.closePollAtomic(poll.id);

                if (!result.success) {
                    reject(
                        socket,
                        result.reason === "POLL_NOT_ACTIVE"
                            ? "There is no open poll to close."
                            : "Failed to close the poll. Please try again."
                    );
                    return;
                }

                console.log(`Poll ${poll.id} closed.`);

                await store.publishPollUpdate();
                await broadcastPoll();
                return;
            } catch (error) {
                console.error("Failed to close poll:", error.message);
                reject(socket, "Failed to close the poll. Please try again.");
                return;
            }
        }


        reject(socket, "Unknown request type.");
    });

    socket.on("close", async () => {
    if (socket.sessionRefreshInterval) {
        clearInterval(socket.sessionRefreshInterval);
    }

   if (users.has(socket)) {
    const user = users.get(socket);

    console.log(`${user.username} disconnected`);

    users.delete(socket);

    if (socket.sessionId) {
        try {
            await store.markUserDisconnected(
                socket.sessionId,
                user.username
            );
        } catch (error) {
            console.error(
                "Failed to mark user disconnected:",
                error.message
            );
        }
    }

    await broadcastUsers();
}
});

    socket.on("error", error => {
        console.error("WebSocket error:", error.message);
    });
});


async function startServer() {
    try {
        await store.connectRedis();

        console.log("Redis connection successful.");

                await store.subscribePollUpdates(async message => {
            if (message === "pollUpdate") {
                await broadcastPoll();
            }
        });

        await store.subscribeUserUpdates(async message => {
    if (message === "usersUpdate") {
        await broadcastUsers();
    }
});

    console.log("Subscribed to Redis user updates.");

        setInterval(async () => {
        try {
            await store.cleanupExpiredSessions();
        } catch (error) {
            console.error("Session cleanup failed:", error.message);
        }
    }, 10000);

        server.listen(PORT, () => {
            console.log(`Server 1 is running at http://localhost:${PORT}`);
            console.log(`WebSocket server is listening on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start Server 1:", error.message);
        process.exitCode = 1;
    }
}

startServer();

