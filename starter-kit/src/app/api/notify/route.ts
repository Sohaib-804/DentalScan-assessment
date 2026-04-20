import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * CHALLENGE: NOTIFICATION SYSTEM
 * 
 * Your goal is to implement a robust notification logic.
 * 1. When a scan is "completed", create a record in the Notification table.
 * 2. Return a success status to the client.
 * 3. Bonus: Handle potential errors (e.g., database connection issues).
 */

/** Stable demo clinic user for `Notification.userId` — must not use `crypto.randomUUID()` (value would change every server boot).
 * This decision was made to allow for better testing/development purposes. 
 * Real-world scenario would use dynamic values that are fetched and updated accordingly.
 */

const CLINIC_USER_ID = "11111111-1111-4111-8111-111111111111";

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

    const { scanId, status, images } = body as {
      scanId?: string;
      status?: string;
      images?: string | string[];
    };

    if (status !== "completed") {
      return NextResponse.json(
        { ok: false, error: "Only status \"completed\" triggers notifications" },
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
            status: "completed",
            ...(imagesField !== "" ? { images: imagesField } : {}),
          },
        });
      } else {
        scan = await tx.scan.create({
          data: {
            status: "completed",
            images: imagesField,
          },
        });
      }

      const notification = await tx.notification.create({
        data: {
          userId: CLINIC_USER_ID,
          title: "Scan completed",
          message: `A patient finished scan ${scan.id}. Open telehealth to review.`,
          read: false,
        },
      });

      return { scan, notification };
    });

    return NextResponse.json({
      ok: true,
      scanId: result.scan.id,
      notificationId: result.notification.id,
      read: result.notification.read,
      message: "Notification recorded",
    });
  } catch (err) {
    console.error("Notification API Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
