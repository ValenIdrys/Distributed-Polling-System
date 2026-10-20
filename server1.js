
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

const PASSWORDS = {
    lecturer: "lecturer123",
    student: "student123"
};

const users = new Map();

let pollCounter = 0;
let activePoll = null;
let latestPoll = null;

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

function getUsers() {
    return Array.from(users.values());
}

function broadcastUsers() {
    broadcast({
        type: "users",
        users: getUsers()
    });
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

function broadcastPoll() {
    broadcast({
        type: "pollUpdate",
        poll: getPollState(activePoll || latestPoll)
    });
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
    sendMessage(socket, {
        type: "users",
        users: getUsers()
    });

    sendMessage(socket, {
        type: "pollUpdate",
        poll: getPollState(activePoll || latestPoll)
    });

    socket.on("message", rawData => {
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

            const duplicate = getUsers().some(
                user => user.username.toLowerCase() === username.toLowerCase()
            );

            if (duplicate) {
                reject(socket, "That username is already connected.");
                return;
            }

            const user = {
                username,
                role,
                server: "Server 1",
                port: PORT
            };

            users.set(socket, user);

            sendMessage(socket, {
                type: "loginSuccess",
                user
            });

            console.log(`${username} logged in as ${role}`);
            broadcastUsers();
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

            if (activePoll) {
                reject(socket, "Close the current poll before creating another.");
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

            pollCounter++;

            activePoll = {
                id: pollCounter,
                question,
                options,
                status: "open",
                votes: []
            };

            latestPoll = activePoll;

            console.log(`Poll ${pollCounter} launched: ${question}`);
            broadcastPoll();
            return;
        }

        if (data.type === "vote") {
            if (user.role !== "student") {
                reject(socket, "Only students can vote.");
                return;
            }

            if (!activePoll || activePoll.status !== "open") {
                reject(socket, "There is no open poll.");
                return;
            }

            const optionIndex = data.optionIndex;

            if (
                !Number.isInteger(optionIndex) ||
                optionIndex < 0 ||
                optionIndex >= activePoll.options.length
            ) {
                reject(socket, "Select a valid answer.");
                return;
            }

            const alreadyVoted = activePoll.votes.some(
                vote => vote.username.toLowerCase() ===
                    user.username.toLowerCase()
            );

            if (alreadyVoted) {
                reject(socket, "You have already voted in this poll.");
                return;
            }

            activePoll.votes.push({
                username: user.username,
                optionIndex,
                timestamp: new Date().toISOString()
            });

            latestPoll = activePoll;

            sendMessage(socket, {
                type: "voteConfirmation",
                message: "Your vote has been submitted."
            });

            console.log(`${user.username} submitted a vote.`);
            broadcastPoll();
            return;
        }

        if (data.type === "closePoll") {
            if (user.role !== "lecturer") {
                reject(socket, "Only lecturers can close polls.");
                return;
            }

            if (!activePoll) {
                reject(socket, "There is no open poll to close.");
                return;
            }

            activePoll.status = "closed";
            latestPoll = activePoll;
            activePoll = null;

            console.log(`Poll ${latestPoll.id} closed.`);
            broadcastPoll();
            return;
        }

        reject(socket, "Unknown request type.");
    });

    socket.on("close", () => {
        if (users.has(socket)) {
            const user = users.get(socket);
            console.log(`${user.username} disconnected`);
            users.delete(socket);
            broadcastUsers();
        }
    });

    socket.on("error", error => {
        console.error("WebSocket error:", error.message);
    });
});

server.listen(PORT, () => {
    console.log(`Server 1 is running at http://localhost:${PORT}`);
    console.log(`WebSocket server is listening on port ${PORT}`);
});
