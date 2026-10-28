
const store = require("./redis-store");

async function main() {
    try {
        await store.connectRedis();

        // Create a test poll.
        const pollId = await store.nextPollId();

        const poll = {
            id: pollId,
            question: "Redis vote test",
            options: ["Option A", "Option B"],
            status: "open",
            votes: []
        };

        await store.savePoll(poll);

        console.log("Created test poll:", pollId);

        // First vote should succeed.
        const first = await store.recordVote(
            pollId,
            "TestStudent",
            0
        );

        console.log("First vote:", first);

        // Same name, different letter case: must be rejected.
        const duplicate = await store.recordVote(
            pollId,
            "teststudent",
            1
        );

        console.log("Duplicate vote:", duplicate);

        const savedPoll = await store.getLatestPoll();
        console.log("Total recorded votes:", savedPoll.votes.length);

        if (
            first.success &&
            !duplicate.success &&
            savedPoll.votes.length === 1
        ) {
            console.log("PASS: Atomic vote test succeeded.");
        } else {
            console.error("FAIL: Atomic vote test did not pass.");
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
