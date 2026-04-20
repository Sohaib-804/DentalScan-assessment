import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * CHALLENGE: MESSAGING SYSTEM
 * 
 * Your goal is to build a basic communication channel between the Patient and Dentist.
 * 1. Implement the POST handler to save a new message into a Thread.
 * 2. Implement the GET handler to retrieve message history for a given thread.
 * 3. Focus on data integrity and proper relations.
 */

const ALLOWED_SENDERS = new Set(["patient", "dentist"]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId")?.trim() || null;
    const scanId = searchParams.get("scanId")?.trim() || null;

    if (!threadId && !scanId) {
      return NextResponse.json({ error: "Provide threadId or scanId" }, { status: 400 });
    }

    if (threadId) {
      const thread = await prisma.thread.findUnique({
        where: { id: threadId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
      }
      return NextResponse.json({
        threadId: thread.id,
        patientId: thread.patientId,
        messages: thread.messages,
      });
    }

    if (!scanId) {
      return NextResponse.json({ error: "Invalid scanId" }, { status: 400 });
    }

    const thread = await prisma.thread.findFirst({
      where: { patientId: scanId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({
      threadId: thread?.id ?? null,
      patientId: scanId,
      messages: thread?.messages ?? [],
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
      scanId?: string;
      content?: string;
      sender?: string;
    };
    const threadId = typeof raw.threadId === "string" ? raw.threadId.trim() || undefined : undefined;
    const scanId = typeof raw.scanId === "string" ? raw.scanId.trim() || undefined : undefined;
    const { content, sender } = raw;

    const trimmed = typeof content === "string" ? content.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }
    if (!sender || !ALLOWED_SENDERS.has(sender)) {
      return NextResponse.json(
        { error: 'sender must be "patient" or "dentist"' },
        { status: 400 },
      );
    }

    if (!threadId && !scanId) {
      return NextResponse.json({ error: "Provide threadId or scanId" }, { status: 400 });
    }

    if (threadId) {
      const exists = await prisma.thread.findUnique({ where: { id: threadId } });
      if (!exists) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
      }
    } else if (!scanId || typeof scanId !== "string" || !scanId.trim()) {
      return NextResponse.json(
        { error: "scanId is required when threadId is omitted" },
        { status: 400 },
      );
    }

    const patientKey = scanId?.trim() ?? "";

    const message = await prisma.$transaction(async (tx) => {
      let resolvedThreadId: string;

      if (threadId) {
        resolvedThreadId = threadId;
      } else {
        let thread = await tx.thread.findFirst({ where: { patientId: patientKey } });
        if (!thread) {
          thread = await tx.thread.create({
            data: { patientId: patientKey },
          });
        }
        resolvedThreadId = thread.id;
      }

      return tx.message.create({
        data: {
          threadId: resolvedThreadId,
          content: trimmed,
          sender,
        },
      });
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
