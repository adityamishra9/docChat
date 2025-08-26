"use client";

import * as React from "react";
import {
  CornerDownLeft,
  Loader2,
  BookOpen,
  Upload,
  Copy,
  Info,
} from "lucide-react";
import type { Doc, Message } from "../page";
import { Alert } from "./ui/alert"; // ⬅️ NEW: show errors at top

/* ----------------------------- Status pill UI ----------------------------- */
function StatusChip({
  status,
}: {
  status: NonNullable<Doc["status"]> | "ready";
}) {
  const cls: Record<string, string> = {
    queued: "bg-amber-400/15 text-amber-200 border border-amber-400/30",
    processing: "bg-blue-400/15 text-blue-200 border border-blue-400/30",
    ready: "bg-emerald-400/15 text-emerald-200 border border-emerald-400/30",
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

/* ------------------------------ Message Bubble ---------------------------- */
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const time = new Date(msg.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[80%] px-4 py-2 rounded-2xl text-sm shadow-md 
          ${
            isUser
              ? "bg-gradient-to-r from-emerald-400/20 to-emerald-500/30 text-emerald-100 border border-emerald-400/30 backdrop-blur-md"
              : "bg-gradient-to-r from-sky-500/20 to-indigo-500/30 text-white border border-white/20 backdrop-blur-md"
          }`}
      >
        <p className="whitespace-pre-wrap">{msg.content}</p>
        <span className="absolute -bottom-4 right-2 text-[10px] text-white/60">
          {time}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------- Component ------------------------------ */
type Props = { doc: Doc; messages: Message[]; onSend: (text: string) => void };

export default function ChatWindow({ doc, messages, onSend }: Props) {
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);

  // ⬇️ NEW: drag+drop + feedback
  const [dragOver, setDragOver] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [uploadingMsg, setUploadingMsg] = React.useState<string | null>(null);

  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const userIsNearBottomRef = React.useRef(true);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  /* ----------------------- scrolling + autosize ----------------------- */
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 80;
      userIsNearBottomRef.current =
        el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (el && userIsNearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, doc.id]);

  const autosize = React.useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 20 * 8 + 16)}px`;
  }, []);
  React.useEffect(() => {
    autosize();
  }, [text, autosize]);

  /* ----------------------------- send message ----------------------------- */
  const submit = async (value?: string) => {
    const payload = (value ?? text).trim();
    if (!payload || sending) return;
    setSending(true);
    try {
      await onSend(payload);
    } finally {
      setSending(false);
      setText("");
      scrollerRef.current?.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  /* ------------------------------ upload PDF ------------------------------ */
  async function uploadPdf(file: File) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setErrorMsg("We currently support PDF files only.");
      // auto-clear after a bit
      setTimeout(() => setErrorMsg(null), 3000);
      return;
    }

    try {
      setUploadingMsg(`Uploading “${file.name}”…`);
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(`${API_BASE}/upload/pdf`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      setUploadingMsg(`Uploaded “${file.name}”. Processing…`);
      // broadcast so AppHome (and others) can add immediately
      window.dispatchEvent(
        new CustomEvent("docchat:uploaded", {
          detail: json?.uploaded || [],
        })
      );
    } catch (e) {
      setErrorMsg("Upload failed. Please try again.");
      setTimeout(() => setErrorMsg(null), 3000);
    } finally {
      setTimeout(() => setUploadingMsg(null), 1500);
    }
  }

  function openGlobalPicker() {
    const input = document.getElementById(
      "global-upload"
    ) as HTMLInputElement | null;
    if (input) input.click();
    else window.dispatchEvent(new CustomEvent("docchat:open-upload"));
  }

  /* ----------------------------- helpers/consts ---------------------------- */
  const lastAssistant = React.useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages]
  );
  const disabled = sending || (doc.status && doc.status !== "ready");
  const FILE_URL = `${API_BASE}/files/${encodeURIComponent(doc.id)}`;

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      // ⬇️ Drag & drop anywhere in window
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // only hide when leaving the root
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) await uploadPdf(file);
      }}
    >
      {/* Optional glass overlay while dragging */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-emerald-500/10 border-2 border-dashed border-emerald-400/50">
          <div className="text-emerald-100 text-sm">
            Drop your PDF to upload
          </div>
        </div>
      )}

      {/* Error / Upload banners */}
      {errorMsg && (
        <div className="px-4 sm:px-6 pt-3">
          <Alert variant="error" title="Unsupported file">
            {errorMsg}
          </Alert>
        </div>
      )}
      {uploadingMsg && (
        <div className="px-4 sm:px-6 pt-3">
          <Alert variant="info" title="Upload">
            {uploadingMsg}
          </Alert>
        </div>
      )}

      {/* Header */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/10 flex items-center justify-between sticky top-0 bg-white/5 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-medium truncate">{doc.name}</h2>
          <a
            href={FILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center p-1 rounded hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
            title="Open original PDF"
          >
            <Info size={16} className="text-white/80" />
          </a>
          <StatusChip status={doc.status ?? "ready"} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* <button
            type="button"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/10 text-xs"
            onClick={() =>
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }))
            }
            title="Open Library (L)"
          >
            <BookOpen size={14} /> Library
          </button> */}
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("docchat:new-chat", {
                  detail: { docId: doc.id },
                })
              )
            }
            title="Start a new chat"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg 
               bg-indigo-500/20 hover:bg-indigo-500/30 
               text-indigo-100 border border-indigo-400/30
               text-xs font-medium shadow-lg shadow-indigo-500/10"
          >
            New chat
          </button>
          <button
            type="button"
            disabled={!lastAssistant}
            onClick={async () =>
              lastAssistant &&
              (await navigator.clipboard.writeText(lastAssistant.content))
            }
            title="Copy last answer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg 
               border border-white/10 text-white/80 hover:bg-white/10 
               text-xs disabled:opacity-40"
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>

      {/* Status banner */}
      {doc.status && doc.status !== "ready" && (
        <div className="px-4 sm:px-6 py-2 text-white/80 text-sm border-b border-white/10 bg-white/5 shrink-0">
          {doc.status === "processing" &&
            "We’re processing your document. You can browse others in the meantime."}
          {doc.status === "queued" && "Your document is queued for processing…"}
          {doc.status === "error" &&
            "We hit an error processing this document. Try re-uploading."}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-6"
      >
        {messages.length === 0 ? (
          <div className="h-full w-full grid place-items-center text-center text-white/70">
            <div>
              <div className="text-5xl mb-3">💬</div>
              <p className="mb-4">
                Ask anything about this PDF to get started.
              </p>
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
                Tip: Press <kbd className="px-1 rounded bg-white/10">⌘K</kbd> to
                switch documents
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} msg={m} />)
        )}
      </div>

      {/* Composer */}
      <div className="px-4 sm:px-6 py-4 border-t border-white/10 shrink-0">
        <div className="flex items-end gap-2">
          {/* textarea column */}
          <div className="relative flex-1">
            <textarea
              id="chat-input" 
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
              className="w-full max-h-40 resize-none overflow-auto thin-scrollbar
                   rounded-xl bg-black/30 border border-white/10 
                   text-white placeholder:text-white/50 
                   px-4 py-3 outline-none focus:ring-2 focus:ring-white/20 
                   disabled:opacity-60"
            />
          </div>

          {/* send button */}
          <button
            onClick={() => submit()}
            disabled={disabled || !text.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 
                 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-black 
                 font-medium disabled:opacity-60 mb-3"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CornerDownLeft size={16} className="mt-1"/>
            )}
            <span>{sending ? "Sending" : "Send"}</span>
          </button>
        </div>

        <div className="mt-2 text-[11px] text-white/50">
          Press <kbd className="px-1 rounded bg-white/10">Enter</kbd> to send •{" "}
          <kbd className="px-1 rounded bg-white/10">Shift</kbd>+
          <kbd className="px-1 rounded bg-white/10">Enter</kbd> for new line
        </div>
      </div>
    </div>
  );
}
