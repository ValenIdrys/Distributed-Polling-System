
const store = require("./redis-store");

async function main() {
    try {
        await store.connectRedis();

        // Clear test state so this test starts cleanly.
        await store.redis.del("poll:active", "poll:latest");

        const first = await store.createPollAtomic(
            "First test poll",
            ["Option A", "Option B"]
        );

        const second = await store.createPollAtomic(
            "Second test poll",
            ["Option C", "Option D"]
        );

        console.log("First poll:", first);
        console.log("Second poll:", second);

        if (first.success && !second.success) {
            console.log("PASS: Only one active poll was created.");
        } else {
            console.error("FAIL: Unexpected poll creation results.");
            process.exitCode = 1;
        }
    } finally {
        if (store.redis.isOpen) {
            await store.redis.quit();
        }
    }
}

main().catch(error => {
    console.error("Test failed:", error);
    process.exitCode = 1;
});
