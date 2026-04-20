import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PATIENT_ID } from "@/lib/notify-constants";
import { enqueueScanNotification } from "@/lib/scan-notification-queue";

/**
 * CHALLENGE: NOTIFICATION SYSTEM
 *
 * Scan + thread are persisted in a Prisma transaction and returned immediately.
 * Clinic `Notification` rows are created asynchronously via BullMQ + Redis (see `npm run worker`).
 */

function normalizeImagesField(images: unknown): string {
  if (Array.isArray(images)) {
    return images.filter((item) => typeof item === "string").join(",");
  }
  if (typeof images === "string") {
    return images;
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { scanId, status, images, patientId } = body as {
      scanId?: string;
      status?: string;
      images?: string | string[];
      patientId?: string;
    };

    const resolvedPatientId =
      typeof patientId === "string" && patientId.trim() !== "" ? patientId.trim() : DEFAULT_PATIENT_ID;

    if (status !== "completed") {
      return NextResponse.json(
        { ok: false, error: 'Only status "completed" triggers notifications' },
        { status: 400 },
      );
    }

    const imagesField = normalizeImagesField(images);

    if (scanId && typeof scanId === "string") {
      const existing = await prisma.scan.findUnique({ where: { id: scanId } });
      if (!existing) {
        return NextResponse.json({ error: "Scan not found" }, { status: 404 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let scan;

      if (scanId && typeof scanId === "string") {
        scan = await tx.scan.update({
          where: { id: scanId },
          data: {
            patientId: resolvedPatientId,
            status: "completed",
            ...(imagesField !== "" ? { images: imagesField } : {}),
          },
        });
      } else {
        scan = await tx.scan.create({
          data: {
            patientId: resolvedPatientId,
            status: "completed",
            images: imagesField,
          },
        });
      }

      let thread = await tx.thread.findFirst({
        where: { scanId: scan.id },
      });
      if (!thread) {
        thread = await tx.thread.create({
          data: { scanId: scan.id },
        });
      }

      return { scan, thread };
    });

    let notificationQueued = false;
    let queueWarning: string | null = null;
    try {
      await enqueueScanNotification(result.scan.id);
      notificationQueued = true;
    } catch (queueErr) {
      console.error("Failed to enqueue scan notification job:", queueErr);
      queueWarning =
        "Scan saved but clinic notification could not be queued. Is Redis running and is the worker started?";
    }

    return NextResponse.json({
      ok: true,
      scanId: result.scan.id,
      threadId: result.thread.id,
      notificationQueued,
      ...(queueWarning ? { warning: queueWarning } : {}),
      message: notificationQueued
        ? "Scan saved; clinic notification queued"
        : "Scan saved; notification queue unavailable",
    });
  } catch (err) {
    console.error("Notification API Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
