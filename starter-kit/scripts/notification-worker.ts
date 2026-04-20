/**
 * BullMQ worker: creates `Notification` rows after scans are saved (see POST /api/notify).
 *
 * Run from `starter-kit/`: `npm run worker`
 * Requires Redis (`docker compose up -d`) and `REDIS_URL` if not default.
 */
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../src/lib/prisma";
import { CLINIC_USER_ID } from "../src/lib/notify-constants";
import {
  SCAN_NOTIFICATION_QUEUE_NAME,
  type ScanNotificationJobData,
} from "../src/lib/scan-notification-queue";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<ScanNotificationJobData>(
  SCAN_NOTIFICATION_QUEUE_NAME,
  async (job) => {
    const { scanId } = job.data;
    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) {
      throw new Error(`Scan not found: ${scanId}`);
    }
    await prisma.notification.create({
      data: {
        userId: CLINIC_USER_ID,
        title: "Scan completed",
        message: `A patient finished scan ${scan.id}. Open telehealth to review.`,
        read: false,
      },
    });
  },
  { connection },
);

worker.on("completed", (job) => {
  console.log(`[scan-notification] job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[scan-notification] job ${job?.id} failed`, err);
});

async function shutdown() {
  console.log("[scan-notification] shutting down…");
  await worker.close();
  await connection.quit().catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log(`[scan-notification] worker listening (${redisUrl})`);
