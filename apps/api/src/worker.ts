import { connectDb } from "./db.js";
import { isRedisAvailable } from "./queues/connection.js";
import { createMatchWorker } from "./workers/match.worker.js";
import { createSearchWorker } from "./workers/search.worker.js";

async function main() {
  await connectDb();

  if (!(await isRedisAvailable())) {
    console.warn(
      "[worker] Redis is not running — BullMQ workers skipped. Dashboard collect and Auto Apply scans still work. Run: npm run docker:up"
    );
    return;
  }

  const workers = [createSearchWorker(), createMatchWorker()];

  console.log("BullMQ workers running (collect, match)");

  for (const w of workers) {
    w.on("failed", (job, err) => {
      console.error(`[${job?.queueName}] job ${job?.id} failed:`, err.message);
    });
  }

  process.on("SIGINT", async () => {
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
