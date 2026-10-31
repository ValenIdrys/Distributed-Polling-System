const store = require("./redis-store");

async function runTest() {
    const sessionId = "test-session-001";

    const user = {
        username: "SessionTestUser",
        role: "student",
        server: "Test Server",
        port: 3000
    };

    try {
        await store.connectRedis();

        console.log("1. Testing session registration...");

        const registration = await store.registerUserSession(
            sessionId,
            user
        );

        console.log("Registration:", registration);

        if (!registration.success) {
            throw new Error("Session registration failed.");
        }

        console.log("\n2. Testing duplicate username prevention...");

        const duplicate = await store.registerUserSession(
            "test-session-002",
            user
        );

        console.log("Duplicate registration:", duplicate);

        if (duplicate.success || duplicate.reason !== "USERNAME_TAKEN") {
            throw new Error("Duplicate username prevention failed.");
        }

        console.log("\n3. Testing session refresh...");

        const refreshed = await store.refreshUserSession(sessionId);
        console.log("Session refreshed:", refreshed);

        if (!refreshed) {
            throw new Error("Session refresh failed.");
        }

        console.log("\n4. Testing connected-user retrieval...");

        const users = await store.getConnectedUsers();
        const found = users.some(u => u.username === user.username);

        console.log("Test user found:", found);

        if (!found) {
            throw new Error("Could not retrieve registered user.");
        }

               console.log("\n5. Testing unexpected disconnection...");

const disconnected = await store.markUserDisconnected(
    sessionId,
    user.username
);

console.log("User marked disconnected:", disconnected);

if (!disconnected) {
    throw new Error("Failed to mark user disconnected.");
}

const connectedUsers = await store.getConnectedUsers();

const userStillConnected = connectedUsers.some(
    u => u.username === user.username
);

console.log("Disconnected user still appears online:", userStillConnected);

if (userStillConnected) {
    throw new Error("Disconnected user still appears online.");
}

// Confirm the session still exists for recovery.
const savedSession = await store.redis.hGet(
    "users:sessions",
    sessionId
);

if (!savedSession) {
    throw new Error("Session was deleted instead of retained.");
}

console.log("\n6. Testing session recovery on another server...");

const resumed = await store.resumeUserSession(
    sessionId,
    "Server 2",
    3001
);

console.log("Session resumed:", resumed);

if (!resumed.success) {
    throw new Error("Session recovery failed.");
}

if (
    resumed.user.server !== "Server 2" ||
    resumed.user.port !== 3001 ||
    resumed.user.connected !== true
) {
    throw new Error("Session recovery information was not updated.");
}

const recoveredUsers = await store.getConnectedUsers();

const userAppearsOnline = recoveredUsers.some(
    u => u.username === user.username
);

console.log("Recovered user appears online:", userAppearsOnline);

if (!userAppearsOnline) {
    throw new Error("Recovered user did not reappear online.");
}

console.log("Updated user:", resumed.user);

                console.log("\n7. Testing session removal...");

        const removed = await store.removeUserSession(
            sessionId,
            user.username
        );

        console.log("Session removed:", removed);

        if (!removed) {
            throw new Error("Session removal failed.");
        }

        console.log("\n8. Testing expired-session cleanup...");

        const expirySessionId = "test-session-expiry-001";

        const expiryUser = {
            username: "ExpiryTestUser",
            role: "student",
            server: "Test Server",
            port: 3000
        };

        const expiryRegistration = await store.registerUserSession(
            expirySessionId,
            expiryUser
        );

        if (!expiryRegistration.success) {
            throw new Error("Expiry test session registration failed.");
        }

        await store.redis.zAdd("users:expiry", [{
            score: Date.now() - 1000,
            value: expirySessionId
        }]);

        const remainingUsers = await store.getConnectedUsers();

        const stillExists = remainingUsers.some(
            u => u.username === expiryUser.username
        );

        console.log("Expired user still exists:", stillExists);

        if (stillExists) {
            throw new Error("Expired session was not removed.");
        }

        console.log("\nALL SESSION TESTS PASSED!");

    } catch (error) {
        console.error("\nTEST FAILED:", error.message);
        process.exitCode = 1;
    } finally {
        await store.redis.quit();
    }
}

runTest();