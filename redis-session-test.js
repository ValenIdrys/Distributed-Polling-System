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

        console.log("\n5. Testing expired-session cleanup...");

        await store.redis.zAdd("users:expiry", [{
            score: Date.now() - 1000,
            value: sessionId
        }]);

        const remainingUsers = await store.getConnectedUsers();
        const stillExists = remainingUsers.some(
            u => u.username === user.username
        );

        console.log("Expired user still exists:", stillExists);

        if (stillExists) {
            throw new Error("Expired session was not removed.");
        }

        console.log("\n6. Testing session removal...");

        const removed = await store.removeUserSession(
            sessionId,
            user.username
        );

        console.log("Session removed:", removed);

        console.log("\nALL SESSION TESTS PASSED!");

    } catch (error) {
        console.error("\nTEST FAILED:", error.message);
        process.exitCode = 1;
    } finally {
        await store.redis.quit();
    }
}

runTest();