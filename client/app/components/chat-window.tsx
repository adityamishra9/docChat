"use client";

import * as React from "react";
import {
  CornerDownLeft,
  Copy,
  Info,
  NotebookPen,
  PencilLine,
  Check,
} from "lucide-react";
import type { Doc, Message } from "../page";
import { Alert } from "./ui/alert";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

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

/* ------------------------------ Typing bubble ------------------------------ */
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
    </span>
  );
}

/* ------------------------------ Message Bubble ---------------------------- */
function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // We don’t render raw HTML for safety. If you need it, add rehype-raw carefully.
      components={{
        h1: (p) => <h1 className="text-lg font-semibold mt-2 mb-1" {...p} />,
        h2: (p) => <h2 className="text-base font-semibold mt-2 mb-1" {...p} />,
        h3: (p) => <h3 className="font-semibold mt-2 mb-1" {...p} />,
        p: (p) => <p className="leading-6 my-2" {...p} />,
        ul: (p) => <ul className="list-disc pl-5 my-2 space-y-1" {...p} />,
        ol: (p) => <ol className="list-decimal pl-5 my-2 space-y-1" {...p} />,
        li: (p) => <li className="leading-6" {...p} />,
        blockquote: (p) => (
          <blockquote
            className="border-l-2 border-white/20 pl-3 my-2 italic text-white/90"
            {...p}
          />
        ),
        a: ({ href, children, ...rest }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-white/40 hover:decoration-white"
            {...rest}
          >
            {children}
          </a>
        ),
        table: (p) => (
          <div className="my-3 overflow-x-auto -mx-1">
            <table className="min-w-[480px] text-sm border-collapse" {...p} />
          </div>
        ),
        thead: (p) => <thead className="bg-white/10 text-white" {...p} />,
        th: (p) => (
          <th className="px-3 py-2 text-left border-b border-white/10" {...p} />
        ),
        td: (p) => (
          <td className="px-3 py-2 align-top border-b border-white/5" {...p} />
        ),
        code({ inline, className, children, ...props }: any) {
          // DO NOT pass `inline` to the native <code> element (fixes your TS error)
          const match = /language-(\w+)/.exec(className || "");
          if (!inline && match) {
            return (
              <SyntaxHighlighter
                {...props}
                style={oneDark}
                language={match[1]}
                PreTag="div"
                wrapLongLines
                customStyle={{
                  margin: "0.5rem 0",
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          }
          return (
            <code
              className="px-1 py-0.5 rounded bg-white/10 border border-white/10"
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: (p) => (
          <pre
            className="my-2 rounded-xl bg-black/40 border border-white/10 overflow-auto"
            {...p}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function MessageBubble({
  msg,
  onCopy,
  onEdit,
}: {
  msg: Message;
  onCopy: (text: string) => void;
  onEdit?: (text: string) => void;
}) {
  const isUser = msg.role === "user";
  const time = new Date(msg.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const [copied, setCopied] = React.useState(false);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        {/* Bubble */}
        <div
          className={[
            "relative px-4 py-2 rounded-2xl text-sm shadow-md",
            isUser
              ? "bg-gradient-to-r from-emerald-400/20 to-emerald-500/30 text-emerald-100 border border-emerald-400/30 backdrop-blur-md"
              : "bg-gradient-to-r from-sky-500/20 to-indigo-500/30 text-white border border-white/20 backdrop-blur-md",
          ].join(" ")}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : msg.pending ? (
            <div className="text-white/80">
              <TypingDots />
            </div>
          ) : (
            <div className="prose prose-invert max-w-none prose-pre:my-0 prose-code:font-mono">
              <MarkdownContent>{msg.content}</MarkdownContent>
            </div>
          )}
        </div>

        {/* Meta row */}
        <div
          className={[
            "mt-1 flex items-center text-[11px]",
            isUser
              ? "justify-between pl-1 pr-0.5"
              : "justify-between pl-0.5 pr-1",
          ].join(" ")}
        >
          {/* Left block (assistant icons | user time) */}
          <div className="flex items-center gap-2">
            {isUser ? (
              <span className="text-white/60">{time}</span>
            ) : (
              <>
                {!msg.pending && (
                  <button
                    onClick={async () => {
                      await onCopy(msg.content);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                    title={copied ? "Copied!" : "Copy"}
                    className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10"
                    aria-live="polite"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Right block (assistant time | user icons) */}
          <div className="flex items-center gap-2">
            {isUser ? (
              <>
                <button
                  onClick={async () => {
                    await onCopy(msg.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  title={copied ? "Copied!" : "Copy"}
                  className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10"
                  aria-live="polite"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                {onEdit && (
                  <button
                    onClick={() => onEdit(msg.content)}
                    title="Edit in composer"
                    className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10"
                  >
                    <PencilLine size={14} />
                  </button>
                )}
              </>
            ) : (
              <span className="text-white/60">{time}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Component ------------------------------ */
type Props = { doc: Doc; messages: Message[]; onSend: (text: string) => void };

export default function ChatWindow({ doc, messages, onSend }: Props) {
  const [text, setText] = React.useState("");
  // We keep `sending` just to prevent double-submit; we won’t show a button spinner.
  const [sending, setSending] = React.useState(false);

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
  const disabled = (doc.status && doc.status !== "ready") || sending;
  const FILE_URL = `${API_BASE}/files/${encodeURIComponent(doc.id)}`;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const editIntoComposer = (text: string) => {
    setText(text);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const ta = textareaRef.current;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    });
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) await uploadPdf(file);
      }}
    >
      {/* Drag overlay */}
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
            <NotebookPen size={14} />
            New chat
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
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              onCopy={copyText}
              onEdit={m.role === "user" ? editIntoComposer : undefined}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="px-4 sm:px-6 py-4 border-t border-white/10 shrink-0">
        <div className="flex items-end gap-2">
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

          {/* send button — no spinner here; typing bubble handles “busy” */}
          <button
            onClick={() => submit()}
            disabled={disabled || !text.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 
                 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-black 
                 font-medium disabled:opacity-60 mb-3"
          >
            <CornerDownLeft size={16} className="mt-1" />
            <span>Send</span>
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
