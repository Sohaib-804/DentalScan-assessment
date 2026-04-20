"use client";

import React, { useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw, Send } from "lucide-react";

type ApiMessage = {
  id: string;
  threadId: string;
  content: string;
  sender: string;
  createdAt: string;
};

/** Message as shown in the list — may be optimistic until the server ACKs. */
type UiMessage = ApiMessage & { pending?: boolean };

type Props = {
  /** Server thread id (created with the completed scan — see POST /api/notify). */
  threadId: string;
  /** Optional scan id for UI copy only. */
  scanId?: string | null;
};

/**
 * Task 3: post-scan quick messaging (R1).
 * Messages are loaded with GET ?threadId=… (not embedded on Thread in Prisma).
 * R3: optimistic UI — message appears immediately; on failure the draft is restored.
 */
export default function QuickMessageSidebar({ threadId, scanId }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/messaging?threadId=${encodeURIComponent(threadId)}`);
      const data = (await res.json()) as {
        threadId?: string;
        messages?: ApiMessage[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Failed to load (${res.status})`);
      }
      setMessages((data.messages ?? []).map((m) => ({ ...m, pending: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load messages");
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const optimisticId = crypto.randomUUID();
    const optimistic: UiMessage = {
      id: optimisticId,
      threadId,
      content: text,
      sender: "patient",
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/messaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          content: text,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        threadId?: string;
        message?: ApiMessage;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.message) {
        throw new Error(data.error || `Send failed (${res.status})`);
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...data.message!, pending: false } : m)),
      );
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text);
      setError(e instanceof Error ? e.message : "Send failed — try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="flex h-full min-h-0 max-h-full w-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 text-left">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <MessageSquare className="text-blue-400 shrink-0" size={18} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Message clinic</p>
          <p className="text-[10px] text-zinc-500 truncate">
            Thread {threadId.slice(0, 8)}…
            {scanId ? ` · scan ${scanId.slice(0, 8)}…` : ""}
          </p>
        </div>
        {!loading && (
          <button
            type="button"
            onClick={() => void loadMessages()}
            className="shrink-0 p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
            aria-label="Refresh messages"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
        {loading && <p className="text-xs text-zinc-500">Loading conversation…</p>}
        {!loading && error && messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="text-xs text-blue-400 underline"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && messages.length === 0 && !error && (
          <p className="text-xs text-zinc-500">
            No messages yet. Send a note to your clinic — they will see it on this thread.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-md px-2 py-1.5 text-xs max-w-[95%] ${
              m.sender === "patient"
                ? "ml-auto bg-blue-950 text-blue-100 border border-blue-900"
                : "mr-auto bg-zinc-800 text-zinc-100 border border-zinc-700"
            } ${m.pending ? "opacity-80 border-dashed" : ""}`}
          >
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-400">
              {m.sender === "patient" ? "You" : "Clinic"}
              {m.pending ? " · sending…" : ""}
            </span>
            {m.content}
          </div>
        ))}
      </div>

      {error && messages.length > 0 && (
        <p className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[11px] text-rose-400">
          {error}
        </p>
      )}

      <div className="shrink-0 space-y-2 border-t border-zinc-800 bg-zinc-950 p-2">
        <textarea
          rows={2}
          className="w-full resize-none rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 disabled:opacity-50"
          placeholder="Type a quick message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || !draft.trim()}
          className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} />
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </aside>
  );
}
