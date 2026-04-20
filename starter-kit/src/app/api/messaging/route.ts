import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Task 3: Patient–clinic messaging
 *
 * Thread rows no longer embed `messages` in Prisma — list messages by `threadId` via `Message`.
 * GET/POST are keyed by **threadId** (created when the scan completes — see `/api/notify`).
 * POST creates messages as **patient** only.
 */

/** Outgoing messages from this app are patient-only; clinic replies would use a separate channel. */
const PATIENT_SENDER = "patient" as const;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId")?.trim() || null;

    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
    }

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const messages = await prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      threadId: thread.id,
      patientId: thread.patientId,
      messages,
    });
  } catch (err) {
    console.error("Messaging GET Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const raw = body as {
      threadId?: string;
      content?: string;
      sender?: string;
    };
    const threadId = typeof raw.threadId === "string" ? raw.threadId.trim() || undefined : undefined;
    const { content, sender } = raw;

    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }
    if (sender !== undefined && sender !== PATIENT_SENDER) {
      return NextResponse.json(
        { error: "Only patient messages can be sent from this app" },
        { status: 400 },
      );
    }

    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
    }

    const thread = await prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const message = await prisma.message.create({
      data: {
        threadId,
        content: trimmed,
        sender: PATIENT_SENDER,
      },
    });

    await prisma.thread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      threadId: message.threadId,
      message,
    });
  } catch (err) {
    console.error("Messaging POST Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
