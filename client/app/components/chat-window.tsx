"use client";

import * as React from "react";
import {
  CornerDownLeft,
  Loader2,
  BookOpen,
  Upload,
  Copy,
} from "lucide-react";
import type { Doc, Message } from "../page";
import MessageBubble from "./message-bubble";

/* ----------------------------- Status pill UI ----------------------------- */
function StatusChip({
  status,
}: {
  status: NonNullable<Doc["status"]> | "ready";
}) {
  const cls: Record<string, string> = {
    queued:
      "bg-amber-400/15 text-amber-200 border border-amber-400/30",
    processing:
      "bg-blue-400/15 text-blue-200 border border-blue-400/30",
    ready:
      "bg-emerald-400/15 text-emerald-200 border border-emerald-400/30",
    error: "bg-rose-400/15 text-rose-200 border border-rose-400/30",
  };
  const label =
    status === "queued"
      ? "Queued"
      : status === "processing"
      ? "Processing"
      : status === "ready"
      ? "Ready"
      : "Error";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ${cls[status]}`}
    >
      <span className="leading-none">{label}</span>
      {status === "processing" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      )}
    </span>
  );
}

/* ------------------------------ Quick prompts ----------------------------- */
const SUGGESTIONS = [
  "Summarize this PDF in 5 bullet points.",
  "List key terms and their definitions.",
  "What are the main arguments or findings?",
  "Extract all dates, names, and figures.",
];

/* --------------------------------- Component ------------------------------ */
type Props = {
  doc: Doc;
  messages: Message[];
  onSend: (text: string) => void;
};

export default function ChatWindow({ doc, messages, onSend }: Props) {
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const userIsNearBottomRef = React.useRef(true);

  // Track if user is reading up; only autoscroll if near bottom
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 80; // px
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
      userIsNearBottomRef.current = atBottom;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll on new messages / doc change if user is near bottom
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (userIsNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, doc.id]);

  // Autosize the textarea (1 → 8 lines)
  const autosize = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const lineHeight = 20; // approx for text-sm
    const maxRows = 8;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, lineHeight * maxRows + 16);
    ta.style.height = `${next}px`;
  }, []);
  React.useEffect(() => {
    autosize();
  }, [text, autosize]);

  const submit = async (value?: string) => {
    const payload = (value ?? text).trim();
    if (!payload || sending) return;
    setSending(true);
    try {
      await onSend(payload);
    } finally {
      setSending(false);
      setText("");
      // ensure we scroll after send
      const el = scrollerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  };

  const lastAssistant = React.useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages]
  );

  const disabled =
    sending || (doc.status && doc.status !== "ready") || doc.status === "ready";

  return (
    <div className="h-[calc(100vh-11rem)] lg:h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/10 flex items-center justify-between sticky top-0 bg-white/5 backdrop-blur-xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-white font-medium truncate">{doc.name}</h2>
            <StatusChip status={doc.status ?? "ready"} />
          </div>
          <p className="text-[11px] text-white/60 mt-0.5">
            {doc.pages ? `${doc.pages} pages` : "PDF"}
            {doc.createdAt ? ` • ${new Date(doc.createdAt).toLocaleString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/10 text-xs"
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }))}
            title="Open Library (L)"
          >
            <BookOpen size={14} />
            Library
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-400/30 text-emerald-200 hover:bg-emerald-400/10 text-xs"
            onClick={() =>
              (document.getElementById("mobile-upload") as HTMLInputElement | null)?.click()
            }
            title="Upload (U)"
          >
            <Upload size={14} />
            Upload
          </button>
          <button
            type="button"
            disabled={!lastAssistant}
            onClick={async () => {
              if (!lastAssistant) return;
              await navigator.clipboard.writeText(lastAssistant.content);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/10 text-xs disabled:opacity-40"
            title="Copy last answer"
          >
            <Copy size={14} />
            Copy
          </button>
        </div>
      </div>

      {/* Status banner when not ready / error */}
      {doc.status && doc.status !== "ready" && (
        <div className="px-4 sm:px-6 py-2 text-white/80 text-sm border-b border-white/10 bg-white/5">
          {doc.status === "processing" &&
            "We’re processing your document. You can browse others in the meantime."}
          {doc.status === "queued" &&
            "Your document is queued for processing…"}
          {doc.status === "error" &&
            "We hit an error processing this document. Try re-uploading."}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="h-full w-full grid place-items-center text-center text-white/70">
            <div>
              <div className="text-5xl mb-3">💬</div>
              <p className="mb-4">Ask anything about this PDF to get started.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="text-xs rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-white/80"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-white/50 mt-4">
                Tip: Press <kbd className="px-1 rounded bg-white/10">⌘K</kbd> to switch documents
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} msg={m} />)
        )}
      </div>

      {/* Composer */}
      <div className="px-4 sm:px-6 py-4 border-t border-white/10">
        <div className="relative">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onInput={autosize}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              doc.status && doc.status !== "ready"
                ? "Document isn’t ready yet…"
                : "Ask a question about this document…"
            }
            className="w-full resize-none rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-white/50 px-4 py-3 pr-12 outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-60"
          />
          <button
            onClick={() => submit()}
            disabled={disabled || !text.trim()}
            className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-black font-medium disabled:opacity-60"
            aria-label="Send"
            title="Send (Enter)"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <CornerDownLeft size={16} />}
            {sending ? "Sending" : "Send"}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-white/50">
          Press <kbd className="px-1 rounded bg-white/10">Enter</kbd> to send •{" "}
          <kbd className="px-1 rounded bg-white/10">Shift</kbd>+<kbd className="px-1 rounded bg-white/10">Enter</kbd> for a new line
        </div>
      </div>
    </div>
  );
}