import { Queue } from "bullmq";
import { redisConnection, isRedisAvailable, REDIS_UNAVAILABLE } from "./connection.js";
import { QUEUE, type QueueName } from "./names.js";

export { QUEUE } from "./names.js";

const defaultJobOptions = {
  removeOnComplete: 100,
  removeOnFail: 200,
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 3000 },
};

const cache = new Map<QueueName, Queue>();
let redisReady: boolean | undefined;

async function ensureRedis(): Promise<void> {
  if (redisReady === true) return;
  if (redisReady === false) {
    throw new Error(REDIS_UNAVAILABLE);
  }
  redisReady = await isRedisAvailable();
  if (!redisReady) {
    throw new Error(REDIS_UNAVAILABLE);
  }
}

function createQueue(name: QueueName): Queue {
  let q = cache.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection,
      defaultJobOptions,
    });
    cache.set(name, q);
  }
  return q;
}

/** Call before queue operations from API routes. */
export async function requireRedis(): Promise<void> {
  await ensureRedis();
}

export async function getSearchQueue(): Promise<Queue> {
  await ensureRedis();
  return createQueue(QUEUE.SEARCH);
}

export async function getMatchQueue(): Promise<Queue> {
  await ensureRedis();
  return createQueue(QUEUE.MATCH);
}

/** Workers call after confirming Redis is up — no extra probe. */
export function getSearchQueueSync(): Queue {
  return createQueue(QUEUE.SEARCH);
}

export function getMatchQueueSync(): Queue {
  return createQueue(QUEUE.MATCH);
}
