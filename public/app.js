
const $ = id => document.getElementById(id);

const connectionStatus = $("connectionStatus");
const serverInfo = $("serverInfo");
const loginForm = $("loginForm");
const loginMessage = $("loginMessage");
const roleSelect = $("role");
const passwordInput = $("password");
const passwordContainer = $("passwordContainer");
const loginButton = $("loginButton");

function updateLoginForm() {
    const isLecturer = roleSelect.value === "lecturer";

    passwordContainer.classList.toggle("hidden", !isLecturer);
    passwordInput.required = isLecturer;

    if (!isLecturer) {
        passwordInput.value = "";
    }

    loginButton.textContent = isLecturer
        ? "Log In as Lecturer"
        : "Join as Student";
}

roleSelect.addEventListener("change", updateLoginForm);
updateLoginForm();
const loginSection = $("loginSection");
const dashboard = $("dashboard");
const lecturerPanel = $("lecturerPanel");
const pollForm = $("pollForm");
const closePollButton = $("closePollButton");
const pollPanel = $("pollPanel");
const voteMessage = $("voteMessage");

let currentUser = null;
let currentPoll = null;
let hasVoted = false;

const protocol = location.protocol === "https:" ? "wss:" : "ws:";

const servers = [
    { host: location.hostname, port: 3000 },
    { host: location.hostname, port: 3001 }
];

let socket = null;
let currentServerIndex = location.port === "3001" ? 1 : 0;
let reconnectTimer = null;
let reconnectAttempts = 0;
let reconnecting = false;
let pendingLogin = null;
let sessionId = sessionStorage.getItem("pollingSessionId");
let manuallyDisconnected = false;

function send(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        voteMessage.textContent = "Server connection is unavailable.";
        return;
    }

    socket.send(JSON.stringify(data));
}

function connectToServer(serverIndex) {
    if (manuallyDisconnected) return;

    currentServerIndex = serverIndex;

    const server = servers[serverIndex];

    connectionStatus.textContent =
        `Connecting to Server ${serverIndex + 1}...`;

    socket = new WebSocket(
        `${protocol}//${server.host}:${server.port}`
    );

    socket.addEventListener("open", () => {
    reconnectAttempts = 0;

        connectionStatus.textContent = "WebSocket connected";

        if (sessionId) {
            socket.send(JSON.stringify({
                type: "resumeSession",
                sessionId
            }));
        } else if (pendingLogin) {
            socket.send(JSON.stringify(pendingLogin));
        }
    });

    socket.addEventListener("message", handleMessage);

    socket.addEventListener("close", () => {
        if (manuallyDisconnected) return;

        connectionStatus.textContent = "Connection lost. Reconnecting...";

        scheduleReconnect();
    });

    socket.addEventListener("error", () => {
        connectionStatus.textContent = "Connection error";
    });
}

function scheduleReconnect() {
    if (reconnecting || manuallyDisconnected) return;

    reconnecting = true;

    reconnectTimer = setTimeout(() => {
        reconnecting = false;

        const nextServerIndex = (currentServerIndex + 1) % servers.length;

        connectToServer(nextServerIndex);
    }, Math.min(2000 * (reconnectAttempts + 1), 10000));

    reconnectAttempts++;
}

loginForm.addEventListener("submit", event => {
    event.preventDefault();

    const role = roleSelect.value;
    const username = $("username").value.trim();

    if (!username) {
        loginMessage.textContent = "Please enter your name.";
        return;
    }

    if (role === "lecturer" && !passwordInput.value) {
        loginMessage.textContent = "Please enter the lecturer password.";
        return;
    }

    manuallyDisconnected = false;

        pendingLogin = {
            type: "login",
            username,
            role,
            password: role === "lecturer" ? passwordInput.value : ""
        };

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            reconnectAttempts = 0;
            connectToServer(currentServerIndex);
        } else {
            send(pendingLogin);
        }

    loginMessage.textContent = role === "lecturer"
        ? "Checking lecturer credentials..."
        : "Joining the polling system...";
});

    $("logoutButton").addEventListener("click", () => {
        manuallyDisconnected = true;

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        pendingLogin = null;
        sessionId = null;
        sessionStorage.removeItem("pollingSessionId");

        send({ type: "logout" });

        setTimeout(() => {
            socket?.close();

            currentUser = null;
            sessionId = null;
            pendingLogin = null;

            document.body.removeAttribute("data-role");

            dashboard.classList.add("hidden");
            loginSection.classList.remove("hidden");

            loginMessage.textContent = "";
            voteMessage.textContent = "";
            connectionStatus.textContent = "Logged out.";
        }, 200);
    });

pollForm.addEventListener("submit", event => {
    event.preventDefault();

    const options = [
        $("option1").value,
        $("option2").value,
        $("option3").value,
        $("option4").value
    ].map(option => option.trim()).filter(Boolean);

    send({
        type: "createPoll",
        question: $("question").value,
        options
    });
});

closePollButton.addEventListener("click", () => {
    send({ type: "closePoll" });
});

function renderPoll(poll) {
    currentPoll = poll;

    if (!poll) {
        pollPanel.classList.add("hidden");
        closePollButton.classList.add("hidden");
        pollForm.classList.remove("hidden");
        $("launchButton").disabled = false;
        return;
    }

    pollPanel.classList.remove("hidden");

    $("pollQuestion").textContent = poll.question;
    $("pollStatus").textContent =
        poll.status === "open" ? "Poll is open" : "Poll is closed";

    if (currentUser?.role === "lecturer") {
        closePollButton.classList.toggle("hidden", poll.status !== "open");
        pollForm.classList.toggle("hidden", poll.status === "open");
        $("launchButton").disabled = poll.status === "open";
    } else {
        closePollButton.classList.add("hidden");
        pollForm.classList.add("hidden");
    }

    const votingOptions = $("votingOptions");
    votingOptions.replaceChildren();

    if (currentUser?.role === "student" && poll.status === "open") {
        const existingVote = poll.votes.find(
            vote => vote.username.toLowerCase() ===
                currentUser.username.toLowerCase()
        );

        hasVoted = Boolean(existingVote);

        poll.options.forEach((option, index) => {
            const wrapper = document.createElement("div");
            wrapper.className = "vote-option";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "voteOption";
            radio.id = `vote-${index}`;
            radio.value = index;
            radio.disabled = hasVoted;

            const label = document.createElement("label");
            label.htmlFor = radio.id;
            label.textContent = option;

            wrapper.append(radio, label);
            votingOptions.appendChild(wrapper);
        });

        const submitButton = document.createElement("button");
        submitButton.textContent = hasVoted
            ? "Vote Already Submitted"
            : "Submit Vote";
        submitButton.disabled = hasVoted;

        submitButton.addEventListener("click", () => {
            const selected = document.querySelector(
                'input[name="voteOption"]:checked'
            );

            if (!selected) {
                voteMessage.textContent = "Please select an option.";
                return;
            }

            send({
                type: "vote",
                optionIndex: Number(selected.value)
            });

            submitButton.disabled = true;
            voteMessage.textContent = "Submitting vote...";
        });

        votingOptions.appendChild(submitButton);
    } else {
        votingOptions.textContent =
            currentUser?.role === "student" && hasVoted
                ? "Your vote has been recorded."
                : "";
    }

    renderResults(poll);
}

function renderResults(poll) {
    const results = $("results");
    results.replaceChildren();

    for (const item of poll.counts) {
        const row = document.createElement("div");
        row.className = "result-row";

        const label = document.createElement("div");
        label.className = "result-label";

        const name = document.createElement("span");
        name.textContent = item.option;

        const count = document.createElement("span");
        count.textContent = `${item.votes} vote(s)`;

        label.append(name, count);

        const track = document.createElement("div");
        track.className = "result-track";

        const fill = document.createElement("div");
        fill.className = "result-fill";

        const percentage = poll.totalVotes
            ? (item.votes / poll.totalVotes) * 100
            : 0;

        fill.style.width = `${percentage}%`;
        track.appendChild(fill);
        row.append(label, track);
        results.appendChild(row);
    }

    const total = document.createElement("p");
    total.textContent = `Total votes: ${poll.totalVotes}`;
    results.appendChild(total);

    const voteList = $("voteList");
    voteList.replaceChildren();

    if (poll.votes.length === 0) {
        const item = document.createElement("li");
        item.textContent = "No votes submitted yet.";
        voteList.appendChild(item);
    }

    for (const vote of poll.votes) {
        const item = document.createElement("li");
        item.textContent =
            `${vote.username} voted for "${vote.option}" at ` +
            new Date(vote.timestamp).toLocaleTimeString();

        voteList.appendChild(item);
    }
}

function handleMessage(event) {
        let data;

        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        if (data.type === "welcome") {
        serverInfo.textContent = `${data.server} — Port ${data.port}`;

        if (reconnecting || currentUser) {
            connectionStatus.textContent =
                `Reconnected to ${data.server}`;
        }
    }

    if (data.type === "loginSuccess") {
        currentUser = data.user;
        document.body.dataset.role = currentUser.role;
        sessionId = data.sessionId || sessionId;

        if (sessionId) {
            sessionStorage.setItem("pollingSessionId", sessionId);
        }

        pendingLogin = null;
        reconnecting = false;

        loginSection.classList.add("hidden");
        dashboard.classList.remove("hidden");

        $("displayUsername").textContent = currentUser.username;
        $("displayRole").textContent = currentUser.role;
        $("dashboardServer").textContent =
            `${currentUser.server} — Port ${currentUser.port}`;

        lecturerPanel.classList.toggle(
            "hidden",
            currentUser.role !== "lecturer"
        );

        loginMessage.textContent = "";
        renderPoll(currentPoll);
    }

    if (data.type === "error") {
        if (currentUser) {
            voteMessage.textContent = data.message;
        }
        else {
            loginMessage.textContent = data.message;
        }

        const recoveryErrors = [
            "Session expired. Please log in again.",
            "Invalid session token.",
            "Could not restore your session."
        ];

        if (recoveryErrors.includes(data.message)) {
            document.body.removeAttribute("data-role");

            sessionId = null;
            currentUser = null;

            sessionStorage.removeItem("pollingSessionId");

            dashboard.classList.add("hidden");
            loginSection.classList.remove("hidden");

            connectionStatus.textContent =
                "Connected — please log in again.";
        }
    }


    if (data.type === "users") {
        $("userCount").textContent =
            `${data.users.length} user(s) connected`;

        const list = $("userList");
        list.replaceChildren();

        if (!data.users.length) {
            const item = document.createElement("li");
            item.textContent = "No logged-in users.";
            list.appendChild(item);
        }

        for (const user of data.users) {
            const item = document.createElement("li");
            item.textContent =
                `${user.username} (${user.role}) — ${user.server}`;
            list.appendChild(item);
        }
    }

    if (data.type === "pollUpdate") {
        renderPoll(data.poll);
    }

    if (data.type === "voteConfirmation") {
        voteMessage.textContent = data.message;
    }
}

connectToServer(currentServerIndex);
