import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config.js";

let redisWarned = false;

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableOfflineQueue: false,
  connectTimeout: 3000,
  retryStrategy(times) {
    if (times > 2) return null;
    return Math.min(times * 300, 900);
  },
};

export const redisConnection = new Redis(env.redisUrl, redisOptions);

redisConnection.on("error", (err) => {
  if (redisWarned) return;
  redisWarned = true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
    console.warn(
      `[redis] Not available at ${env.redisUrl} — background queues need Redis. Start it with: npm run docker:up`
    );
  } else {
    console.warn("[redis]", msg);
  }
});

export const REDIS_UNAVAILABLE =
  "Redis is not running. Start it with: npm run docker:up (or use POST /api/matcher/collect/sync for in-process collect).";

/** Probe Redis without starting BullMQ queues. */
export async function isRedisAvailable(): Promise<boolean> {
  const probe = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 2500,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    const pong = await probe.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    try {
      probe.disconnect();
    } catch {
      /* ignore */
    }
  }
}
