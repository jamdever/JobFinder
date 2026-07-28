import { Worker } from "bullmq";
import { JobModel } from "../models/Job.js";
import { QUEUE } from "../queues/names.js";
import { redisConnection } from "../queues/connection.js";
import { analyzeJobById } from "../services/matcher.js";

export function createMatchWorker() {
  return new Worker(
    QUEUE.MATCH,
    async (job) => {
      const { jobId } = job.data as { jobId: string };
      try {
        await analyzeJobById(jobId);
        console.log(`[match] analyzed job ${jobId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await JobModel.findByIdAndUpdate(jobId, { errorMessage: message });
        throw err;
      }
    },
    { connection: redisConnection, concurrency: 2 }
  );
}
