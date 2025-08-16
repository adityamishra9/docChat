"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, PlusCircle, Search } from "lucide-react";
import FileUpload from "./components/file-upload";
import SidebarDocs from "./components/sidebar-docs";
import ChatWindow from "./components/chat-window";
import { Alert } from "./components/ui/alert"

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

  // lock scroll & focus input on open
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

  // filter & sort (active first)
  const results = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = !s
      ? docs
      : docs.filter((d) => d.name.toLowerCase().includes(s));
    // Move active to top subtly
    return filtered.sort((a, b) =>
      a.id === activeId ? -1 : b.id === activeId ? 1 : 0
    );
  }, [docs, q, activeId]);

  // keyboard nav in list
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

  // pick doc from URL first
  React.useEffect(() => {
    const q = search.get("doc");
    if (q && q !== activeId) setActiveId(q);
  }, [search]); // eslint-disable-line

  // fetch docs
  const fetchDocs = React.useCallback(async () => {
    try {
      setErrorDocs(null);
      const res = await fetch(`${API_BASE}/documents`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Doc[] = await res.json();
      setDocs(json || []);
      // initialize active doc if none chosen
      if (!activeId && json?.length) {
        setActiveId(json[0].id);
        router.replace(`?doc=${encodeURIComponent(json[0].id)}`);
      }
    } catch (e: any) {
      setErrorDocs("Couldn’t load your library. Check the server & try again.");
    } finally {
      setLoadingDocs(false);
    }
  }, [API_BASE, activeId, router]);

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

  // keep URL in sync when user picks a new doc
  const selectDoc = (id: string) => {
    setActiveId(id);
    router.replace(`?doc=${encodeURIComponent(id)}`);
  };

  // keyboard shortcuts: L (library), U (upload)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key.toLowerCase() === "l") setSidebarOpen((s) => !s);
      if (e.key.toLowerCase() === "u") {
        const el = document.getElementById(
          "mobile-upload"
        ) as HTMLInputElement | null;
        el?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onUploaded = (uploaded: Doc[]) => {
    setDocs((prev) => {
      const next = [...uploaded, ...prev];
      if (!activeId && uploaded[0]) {
        setActiveId(uploaded[0].id);
        router.replace(`?doc=${encodeURIComponent(uploaded[0].id)}`);
      }
      return next;
    });
    // Gentle nudge
    if (uploaded?.length)
      push(
        `Uploaded ${uploaded.length} document${uploaded.length > 1 ? "s" : ""}. We’ll process it in the background.`
      );
  };

  const sendMessage = async (docId: string, content: string) => {
    const addMsg = (m: Message) =>
      setConversations((prev) => ({
        ...prev,
        [docId]: [...(prev[docId] || []), m],
      }));

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      ts: Date.now(),
    };
    addMsg(userMsg);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          message: content,
          // sessionId optional — if backend supports memory per doc+user
          sessionId: `doc-${docId}`,
        }),
      });

      if (!res.ok) {
        addMsg({
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Hmm, I couldn't reach the server. Please try again in a moment.",
          ts: Date.now(),
        });
        push("Chat server unreachable.");
        return;
      }

      const json = await res.json(); // { answer: string }
      addMsg({
        id: crypto.randomUUID(),
        role: "assistant",
        content: json.answer ?? "I don't have a response yet.",
        ts: Date.now(),
      });
    } catch {
      addMsg({
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "I hit a network error. Check your backend URL or internet connection.",
        ts: Date.now(),
      });
      push("Network error while chatting.");
    }
  };

  const activeDoc = docs.find((d) => d.id === activeId) || null;

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
        <label
          htmlFor="mobile-upload"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
          aria-label="Upload (U)"
        >
          <PlusCircle size={18} />
          Upload
        </label>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar */}
        <aside
          className={[
            "lg:static fixed inset-0 lg:inset-auto",
            sidebarOpen ? "z-50" : "pointer-events-none -z-10",
          ].join(" ")}
        >
          <div
            className={`lg:rounded-2xl lg:border lg:border-white/10 lg:bg-white/5 lg:backdrop-blur-xl lg:shadow-xl
              lg:h-[calc(100vh-6rem)] lg:sticky lg:top-20
              h-full w-full lg:w-auto
              ${sidebarOpen ? "pointer-events-auto" : ""}`}
          >
            {/* Mobile scrim */}
            <div
              className={`lg:hidden absolute inset-0 bg-black/50 ${
                sidebarOpen ? "" : "hidden"
              }`}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            {/* Drawer */}
            <div
              className={`lg:static absolute top-0 left-0 h-full w-[85%] max-w-[360px] bg-white/5 backdrop-blur-xl border-r border-white/10 shadow-2xl transform transition-transform ${
                sidebarOpen
                  ? "translate-x-0"
                  : "-translate-x-full lg:translate-x-0"
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

              {/* Upload box inside the sidebar on desktop */}
              <div className="hidden lg:block p-4 border-t border-white/10">
                <FileUpload onUploaded={onUploaded} />
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-h-[70vh] rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          {/* loading / error states */}
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
                <details className="mt-2 opacity-80">
                  <summary className="cursor-pointer text-white/80">
                    Details
                  </summary>
                  <div className="mt-1 text-white/70 text-sm">{errorDocs}</div>
                </details>
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
                <div className="h-full w-full p-6 flex flex-col items-center justify-center text-center text-white/80">
                  <div className="text-5xl mb-4">📄</div>
                  <h2 className="text-xl font-medium">No document selected</h2>
                  <p className="text-white/60 mt-2">
                    Upload one or pick from your library to start chatting.
                  </p>
                  {/* Mobile upload sitting in the empty state */}
                  <div className="lg:hidden mt-6">
                    <FileUpload
                      onUploaded={onUploaded}
                      inputId="mobile-upload"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
