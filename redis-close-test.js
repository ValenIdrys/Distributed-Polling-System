
const store = require("./redis-store");

async function main() {
    try {
        await store.connectRedis();

        // Clear previous test poll state.
        await store.redis.del("poll:active", "poll:latest");

        // Create a poll.
        const created = await store.createPollAtomic(
            "Poll closing test",
            ["Option A", "Option B"]
        );

        console.log("Created poll:", created);

        if (!created.success) {
            throw new Error("Could not create test poll.");
        }

        const pollId = created.poll.id;

        // Close the poll.
        const closed = await store.closePollAtomic(pollId);
        console.log("Closed poll:", closed);

        // Attempt to vote after closing.
        const vote = await store.recordVote(
            pollId,
            "TestStudent",
            0
        );

        console.log("Vote after closing:", vote);

        // Check the final poll state.
        const savedPoll = await store.getLatestPoll();
        console.log("Final poll status:", savedPoll.status);
        const totalVotes = Array.isArray(savedPoll.votes)
            ? savedPoll.votes.length
            : Object.keys(savedPoll.votes || {}).length;

        console.log("Total votes:", totalVotes);

        if (
            closed.success &&
            !vote.success &&
            savedPoll.status === "closed" &&
            totalVotes === 0
        ) {
            console.log("PASS: Closed polls reject votes.");
        } else {
            console.error("FAIL: Poll closing test did not pass.");
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
