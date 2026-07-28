import { Worker } from "bullmq";
import { QUEUE } from "../queues/names.js";
import { redisConnection } from "../queues/connection.js";
import { collectJobs } from "../services/matcher.js";

export function createSearchWorker() {
  return new Worker(
    QUEUE.SEARCH,
    async () => {
      const result = await collectJobs();
      console.log(`[collect] found=${result.found} keyword-eligible=${result.eligible}`);
      return result;
    },
    { connection: redisConnection, concurrency: 1 }
  );
}
