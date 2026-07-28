/** Queue names — import this from workers to avoid loading BullMQ Queue clients at startup. */
export const QUEUE = {
  SEARCH: "search",
  MATCH: "match",
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];
