"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, PlusCircle, Search } from "lucide-react";
import FileUpload from "./components/file-upload";
import SidebarDocs from "./components/sidebar-docs";
import ChatWindow from "./components/chat-window";
import { Alert } from "./components/ui/alert";
import UploadModal from "./components/ui/upload-modal";

export type Doc = {
  id: string;
  name: string;
  size?: number;
  pages?: number;
  status?: "queued" | "processing" | "ready" | "error";
  createdAt?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  /** when true, render a typing bubble and hide actions */
  pending?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

/* ---------------------------- tiny toast system ---------------------------- */
type Toast = { id: string; text: string };
function useToasts() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = (text: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2600);
  };
  return { toasts, push };
}

/* --------------------------- localStorage helpers -------------------------- */
function useLocalStorageState<T>(key: string, initial: T) {
  const [state, setState] = React.useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

/* ------------------------------ Command Bar ------------------------------- */
function useCmdK(toggle: () => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isInput) return;

      const metaK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (metaK) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  docs: Doc[];
  activeId: string | null;
  onSelectDoc: (id: string) => void;
};

function CommandPalette({
  isOpen,
  onClose,
  docs,
  activeId,
  onSelectDoc,
}: CommandPaletteProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  const results = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = !s
      ? docs
      : docs.filter((d) => d.name.toLowerCase().includes(s));
    return filtered.sort((a, b) =>
      a.id === activeId ? -1 : b.id === activeId ? 1 : 0
    );
  }, [docs, q, activeId]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
        scrollIntoView();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
        scrollIntoView();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = results[idx];
        if (pick) {
          onSelectDoc(pick.id);
          onClose();
        }
      }
    };
    const scrollIntoView = () => {
      const item = listRef.current?.querySelector<HTMLLIElement>(
        `li[data-idx="${idx}"]`
      );
      item?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, idx, results, onClose, onSelectDoc]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto mt-24 w-full max-w-xl rounded-2xl border border-white/10 bg-white/8 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <Search size={16} className="text-white/70" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            placeholder="Search documents…"
            className="w-full bg-transparent outline-none text-white placeholder:text-white/50 text-sm py-2"
            aria-label="Search documents"
          />
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 border border-white/10">
            ⌘K
          </kbd>
        </div>

        <ul
          ref={listRef}
          className="max-h-80 overflow-auto p-2"
          role="listbox"
          aria-label="Documents"
        >
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-white/60">
              No matching documents
            </li>
          ) : (
            results.map((d, i) => (
              <li
                key={d.id}
                data-idx={i}
                role="option"
                aria-selected={i === idx}
                className={[
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-2 cursor-pointer",
                  i === idx
                    ? "bg-white/15 border border-white/20"
                    : "hover:bg-white/10",
                ].join(" ")}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  onSelectDoc(d.id);
                  onClose();
                }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{d.name}</p>
                  <p className="text-[11px] text-white/60">
                    {d.pages ? `${d.pages} pages` : "PDF"}
                    {d.createdAt
                      ? ` • ${new Date(d.createdAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <StatusChip status={d.status ?? "ready"} />
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function StatusChip({
  status,
}: {
  status: NonNullable<Doc["status"]> | "ready";
}) {
  const map: Record<string, string> = {
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
      className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${map[status]}`}
    >
      {label}
    </span>
  );
}

/* --------------------------------- Page ----------------------------------- */
export default function AppHome() {
  const router = useRouter();
  const search = useSearchParams();
  const { toasts, push } = useToasts();

  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = React.useState(true);
  const [errorDocs, setErrorDocs] = React.useState<string | null>(null);

  // Persist conversations per doc in localStorage
  const [conversations, setConversations] = useLocalStorageState<
    Record<string, Message[]>
  >("docchat:conversations", {});

  // Active docId synced with URL (?doc=)
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Command palette open
  const [cmdOpen, setCmdOpen] = React.useState(false);
  useCmdK(() => setCmdOpen((s) => !s));

  // drag-over visual state for empty area
  const [dragOver, setDragOver] = React.useState(false);

  // ---- Resizable sidebar state (desktop only) ----
  const SIDEBAR_W_KEY = "docchat:sidebarWidth";
  const MIN_W = 240;
  const MAX_W = 520;
  const DEFAULT_W = 320;

  const [sidebarWidth, setSidebarWidth] = React.useState<number>(DEFAULT_W);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_W_KEY);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          setSidebarWidth(Math.min(MAX_W, Math.max(MIN_W, n)));
        }
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);

  const dragRef = React.useRef<{ startX: number; startW: number } | null>(null);
  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: sidebarWidth };
    document.body.style.userSelect = "none";
  };
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { startX, startW } = dragRef.current;
      const next = Math.min(
        MAX_W,
        Math.max(MIN_W, startW + (e.clientX - startX))
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  // ------------------------------------------------

  // pick doc from URL first
  React.useEffect(() => {
    const q = search.get("doc");
    if (q) setActiveId(q);
  }, [search]);

  // fetch docs
  const fetchDocs = React.useCallback(async () => {
    try {
      setErrorDocs(null);
      const res = await fetch(`${API_BASE}/documents`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Doc[] = await res.json();

      setDocs(json || []);

      setActiveId((curr) => {
        if (!curr) return null;
        const stillExists = (json || []).some((d) => d.id === curr);
        return stillExists ? curr : null;
      });
    } catch {
      setErrorDocs("Couldn’t load your library. Check the server & try again.");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // background polling while any doc not ready
  React.useEffect(() => {
    const needsPoll = docs.some((d) => d.status && d.status !== "ready");
    if (!needsPoll) return;
    const t = setInterval(fetchDocs, 4000);
    return () => clearInterval(t);
  }, [docs, fetchDocs]);

  const selectDoc = (id: string) => setActiveId(id);

  /* ------------------------- Upload plumbing (no modal) ------------------------- */
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  async function uploadPdf(file: File) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      push("Only PDF files are supported.");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(`${API_BASE}/upload/pdf`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      window.dispatchEvent(
        new CustomEvent("docchat:uploaded", { detail: json?.uploaded || [] })
      );
      push(`Uploaded “${file.name}”. Processing…`);
    } catch (e) {
      push("Upload failed. Please try again.");
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }
  const [showUploadModal, setShowUploadModal] = React.useState(false);

  // keyboard shortcuts: L (library), U (upload)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (e.key.toLowerCase() === "l") setSidebarOpen((s) => !s);
      if (e.key.toLowerCase() === "u") setShowUploadModal(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // allow other components to open the upload modal
  React.useEffect(() => {
    const open = () => setShowUploadModal(true);
    window.addEventListener("docchat:open-upload", open as EventListener);
    return () =>
      window.removeEventListener("docchat:open-upload", open as EventListener);
  }, []);

  // pick up uploaded docs from anywhere
  const onUploaded = (uploaded: Doc[]) => {
    setDocs((prev) => {
      const next = [...uploaded, ...prev];
      if (!activeId && uploaded[0]) setActiveId(uploaded[0].id);
      return next;
    });
  };
  React.useEffect(() => {
    const onUploadedEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as Doc[] | undefined;
      if (detail?.length) onUploaded(detail);
    };
    window.addEventListener(
      "docchat:uploaded",
      onUploadedEvent as EventListener
    );
    return () =>
      window.removeEventListener(
        "docchat:uploaded",
        onUploadedEvent as EventListener
      );
  }, []);

  React.useEffect(() => {
    if (activeId) router.replace(`?doc=${encodeURIComponent(activeId)}`);
  }, [activeId, router]);

  /* ---------------------------------- Chat ---------------------------------- */
  const sendMessage = async (docId: string, content: string) => {
    const addMsg = (m: Message) =>
      setConversations((prev) => ({
        ...prev,
        [docId]: [...(prev[docId] || []), m],
      }));

    const replaceMsg = (id: string, patch: Partial<Message>) =>
      setConversations((prev) => {
        const list = prev[docId] || [];
        return {
          ...prev,
          [docId]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        };
      });

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      ts: Date.now(),
    };
    addMsg(userMsg);

    // assistant typing placeholder (renders animated dots)
    const placeholderId = crypto.randomUUID();
    addMsg({
      id: placeholderId,
      role: "assistant",
      content: "",
      pending: true,
      ts: Date.now(),
    });

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          message: content,
          sessionId: `doc-${docId}`,
        }),
      });

      if (!res.ok) {
        replaceMsg(placeholderId, {
          pending: false,
          content:
            "Hmm, I couldn't reach the server. Please try again in a moment.",
          ts: Date.now(),
        });
        push("Chat server unreachable.");
        return;
      }

      const json = await res.json();
      replaceMsg(placeholderId, {
        pending: false,
        content: json.answer ?? "I don't have a response yet.",
        ts: Date.now(),
      });
    } catch {
      replaceMsg(placeholderId, {
        pending: false,
        content:
          "I hit a network error. Check your backend URL or internet connection.",
        ts: Date.now(),
      });
      push("Network error while chatting.");
    }
  };

  const activeDoc = docs.find((d) => d.id === activeId) || null;

  // new chat
  React.useEffect(() => {
    function onNewChat() {
      setActiveId(null);
      router.replace("/");
    }
    window.addEventListener("docchat:new-chat", onNewChat as EventListener);
    return () =>
      window.removeEventListener(
        "docchat:new-chat",
        onNewChat as EventListener
      );
  }, [router]);

  React.useEffect(() => {
    const onEnter = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target?.closest("input, textarea, [contenteditable=true]");
      if (typing) return;

      if (e.key === "Enter") {
        e.preventDefault();
        const input = document.getElementById(
          "chat-input"
        ) as HTMLTextAreaElement | null;
        input?.focus();
      }
    };

    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 pb-8 pt-6">
      {/* toasts */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-white/10 bg-white/10 backdrop-blur-xl px-4 py-2 text-white shadow-2xl"
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* upload modal */}
      <UploadModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploaded={(uploaded: Doc[]) => {
          onUploaded(uploaded);
          setShowUploadModal(false);
        }}
      />

      {/* hidden global picker */}
      <input
        ref={fileInputRef}
        id="global-upload"
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            await uploadPdf(f);
            e.currentTarget.value = "";
          }
        }}
      />

      {/* Command Palette */}
      <CommandPalette
        isOpen={cmdOpen}
        onClose={() => setCmdOpen(false)}
        docs={docs}
        activeId={activeId}
        onSelectDoc={(id) => {
          selectDoc(id);
          setCmdOpen(false);
        }}
      />

      {/* Toolbar (mobile) */}
      <div className="lg:hidden mb-4 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
          aria-label="Open Library (L)"
        >
          <Menu size={18} />
          Library
        </button>
        <button
          onClick={() => setShowUploadModal(true)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
          aria-label="Upload (U)"
        >
          <PlusCircle size={18} />
          Upload
        </button>
      </div>

      {/* Desktop layout */}
      <div className="hidden lg:flex lg:gap-4 h-[calc(100vh-6rem)] min-h-0">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20" style={{ width: sidebarWidth }}>
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-xl h-[calc(100vh-6rem)] overflow-hidden">
            <SidebarDocs
              docs={docs}
              activeId={activeId}
              onSelect={(id) => selectDoc(id)}
              onClearAll={() => {
                setDocs([]);
                setActiveId(null);
                setConversations({});
                router.replace(`/`);
              }}
            />
            <div className="p-4 border-t border-white/10">
              <FileUpload onUploaded={onUploaded} />
            </div>
          </div>
        </aside>

        {/* Drag handle */}
        <div
          className="w-1 mx-1 cursor-col-resize relative select-none"
          title="Drag to resize"
          aria-label="Resize sidebar"
          onMouseDown={onDragStart}
        >
          <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-white/10 hover:bg-white/20 transition-colors" />
        </div>

        {/* Main */}
        <main
          className="flex-1 min-w-0 h-full min-h-0 overflow-hidden flex flex-col rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl"
          onDragOver={(e) => {
            if (activeDoc) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => !activeDoc && setDragOver(false)}
          onDrop={async (e) => {
            if (activeDoc) return;
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await uploadPdf(file);
          }}
        >
          {loadingDocs && (
            <div className="p-6 animate-pulse text-white/70">
              Loading your library…
            </div>
          )}

          {!loadingDocs && errorDocs && (
            <div className="p-6">
              <Alert
                variant="error"
                title="Can’t load your library"
                actions={
                  <>
                    <button
                      onClick={fetchDocs}
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm"
                    >
                      Retry
                    </button>
                    <a
                      href="http://localhost:8000/"
                      target="_blank"
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm"
                    >
                      Health
                    </a>
                  </>
                }
              >
                <div className="mt-1">
                  Check that your backend is running and{" "}
                  <code className="text-white/90">NEXT_PUBLIC_API_BASE</code>{" "}
                  points to it.
                </div>
              </Alert>
            </div>
          )}

          {!loadingDocs && !errorDocs && (
            <>
              {activeDoc ? (
                <ChatWindow
                  key={activeDoc.id}
                  doc={activeDoc}
                  messages={conversations[activeDoc.id] || []}
                  onSend={(text) => sendMessage(activeDoc.id, text)}
                />
              ) : (
                <div className="relative h-full w-full p-6 flex flex-col items-center justify-center text-center">
                  <div className="pointer-events-none absolute inset-0 -z-10">
                    <div
                      className="absolute left-1/2 top-1/3 -translate-x-1/2 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl transition-opacity"
                      style={{ opacity: dragOver ? 0.5 : 1 }}
                    />
                    <div className="absolute right-1/4 bottom-10 h-56 w-56 rounded-full bg-sky-500/10 blur-2xl" />
                  </div>

                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-xl">
                    <span className="text-3xl">📄</span>
                  </div>

                  <h2 className="text-2xl sm:text-3xl font-semibold text-white">
                    Start a Conversation
                  </h2>
                  <p className="mt-3 text-white/70 max-w-md">
                    {dragOver ? (
                      "Release to upload your PDF."
                    ) : (
                      <>
                        Drop a PDF here to begin, press{" "}
                        <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/85 text-[11px] border border-white/15">
                          U
                        </kbd>{" "}
                        to open the file picker, or use the button below.
                      </>
                    )}
                  </p>

                  <div
                    className={[
                      "mt-6 group rounded-2xl border-2 border-dashed px-6 py-4 max-w-md w-full transition-colors",
                      dragOver
                        ? "border-emerald-400 bg-emerald-400/10"
                        : "border-white/15 hover:border-white/25 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-center gap-3 text-white/75">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        className="opacity-80"
                        aria-hidden="true"
                      >
                        <path
                          fill="currentColor"
                          d="M12 2l5 5h-3v6h-4V7H7l5-5zm8 18H4v-6H2v8h20v-8h-2v6z"
                        />
                      </svg>
                      <span className="text-sm">
                        Drag & drop your PDF anywhere in this area
                      </span>
                    </div>
                  </div>

                  <div className="mt-6">
                    <button
                      onClick={openFilePicker}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-black font-medium shadow-2xl shadow-emerald-500/20"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 5v14m-7-7h14"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </svg>
                      Upload a PDF
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/55">
                    <span className="inline-flex items-center gap-1">
                      <kbd className="px-1 rounded bg-white/10 border border-white/10">
                        ⌘K
                      </kbd>{" "}
                      switch documents
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <kbd className="px-1 rounded bg-white/10 border border-white/10">
                        Enter
                      </kbd>{" "}
                      send
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <kbd className="px-1 rounded bg-white/10 border border-white/10">
                        Shift
                      </kbd>
                      +
                      <kbd className="px-1 rounded bg-white/10 border border-white/10">
                        Enter
                      </kbd>{" "}
                      newline
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile layout */}
      <div className="lg:hidden grid lg:grid-cols-[320px_1fr] gap-4">
        <aside
          className={[
            "fixed inset-0 lg:static lg:inset-auto",
            sidebarOpen ? "z-50" : "pointer-events-none -z-10",
          ].join(" ")}
        >
          <div className="h-full w-full">
            <div
              className={`absolute inset-0 bg-black/50 ${sidebarOpen ? "" : "hidden"}`}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <div
              className={`absolute top-0 left-0 h-full w-[85%] max-w-[360px] bg-white/5 backdrop-blur-xl border-r border-white/10 shadow-2xl transform transition-transform ${
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`}
              role="dialog"
              aria-label="Document Library"
            >
              <SidebarDocs
                docs={docs}
                activeId={activeId}
                onSelect={(id) => {
                  selectDoc(id);
                  setSidebarOpen(false);
                }}
                onClearAll={() => {
                  setDocs([]);
                  setActiveId(null);
                  setConversations({});
                  router.replace(``);
                }}
              />
              <div className="p-4 border-t border-white/10">
                <FileUpload onUploaded={onUploaded} />
              </div>
            </div>
          </div>
        </aside>

        <main className="h-[calc(100vh-6rem)] min-h-0 overflow-hidden flex flex-col rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          {!loadingDocs && !errorDocs && activeDoc && (
            <ChatWindow
              key={activeDoc.id}
              doc={activeDoc}
              messages={conversations[activeDoc.id] || []}
              onSend={(text) => sendMessage(activeDoc.id, text)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
