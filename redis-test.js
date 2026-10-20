
const { createClient } = require("redis");

const client = createClient({
    url: "redis://127.0.0.1:6379"
});

client.on("error", error => {
    console.error("Redis error:", error.message);
});

async function testRedis() {
    try {
        await client.connect();

        const response = await client.ping();
        console.log("Redis connection successful:", response);

        await client.quit();
    } catch (error) {
        console.error("Redis connection failed:", error.message);

        if (client.isOpen) {
            await client.quit();
        }

        process.exitCode = 1;
    }
}

testRedis();
