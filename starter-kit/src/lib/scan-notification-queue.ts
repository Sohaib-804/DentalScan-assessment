import { Queue } from "bullmq";
import IORedis from "ioredis";

/** BullMQ queue name — must match the worker in `scripts/notification-worker.ts`. */
export const SCAN_NOTIFICATION_QUEUE_NAME = "scan-notification";

export type ScanNotificationJobData = {
  scanId: string;
};

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const globalForQueue = globalThis as unknown as {
  scanNotificationRedis?: IORedis;
  scanNotificationQueue?: Queue;
};

function getRedis(): IORedis {
  if (!globalForQueue.scanNotificationRedis) {
    globalForQueue.scanNotificationRedis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return globalForQueue.scanNotificationRedis;
}

/**
 * Queue used by API routes to enqueue clinic notifications after scan persist.
 * Uses a duplicated connection per BullMQ recommendations for Next.js hot reload.
 */
export function getScanNotificationQueue(): Queue {
  if (!globalForQueue.scanNotificationQueue) {
    globalForQueue.scanNotificationQueue = new Queue(SCAN_NOTIFICATION_QUEUE_NAME, {
      connection: getRedis().duplicate(),
    });
  }
  return globalForQueue.scanNotificationQueue;
}

/**
 * Enqueue clinic notification for a completed scan. Non-blocking for HTTP once awaited here;
 * DB work for the notification row runs in the worker process.
 */
export async function enqueueScanNotification(scanId: string): Promise<void> {
  const queue = getScanNotificationQueue();
  await queue.add(
    "notify-clinic",
    { scanId } satisfies ScanNotificationJobData,
    {
      jobId: `scan-notify-${scanId}`,
      removeOnComplete: true,
      removeOnFail: 200,
      attempts: 5,
      backoff: { type: "exponential", delay: 1500 },
    },
  );
}
