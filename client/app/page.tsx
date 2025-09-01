"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, PlusCircle } from "lucide-react";
import SidebarDocs from "./components/sidebar-docs";
import FileUpload from "./components/file-upload";
import ChatWindow from "./components/chat-window";
import UploadModal from "./components/ui/upload-modal";
import { Alert } from "./components/ui/alert";

import CommandPalette from "./components/command-palette";
import EmptyState from "./components/empty-state";
import { useToasts, ToastViewport } from "./components/ui/use-toasts";
import { useLocalStorageState } from "./lib/use-localstorage";
import { useCmdK } from "./lib/use-cmdk";
import {
  useAuth,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  SignIn,
  ClerkLoaded,
  ClerkLoading,
} from "@clerk/nextjs";
import { API_BASE, useApi, endpoints } from "./lib/api-client";
import type { Doc, Message } from "./types";

export default function AppHome() {
  const router = useRouter();
  const search = useSearchParams();
  const { toasts, push } = useToasts();
  const { isLoaded, isSignedIn } = useAuth();

  // keep a stable ref to the api instance
  const api = useApi();
  const apiRef = React.useRef(api);
  React.useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const [docs, setDocs] = React.useState<Doc[] | null>(null);
  const [loadingDocs, setLoadingDocs] = React.useState(true);
  const [errorDocs, setErrorDocs] = React.useState<string | null>(null);

  // -------------------- Conversations: live (UI) + persisted (storage) --------------------
  // LocalStorage copy (what gets written to disk)
  const [persistedConversations, setPersistedConversations] =
    useLocalStorageState<Record<string, Message[]>>(
      "docchat:conversations",
      {}
    );

  // Live copy (what the UI renders — can include pending bubbles)
  const [liveConversations, setLiveConversations] = React.useState<
    Record<string, Message[]>
  >(persistedConversations);

  const PENDING_FALLBACK =
    "Looks like the connection dropped while I was answering. Please resend your last question.";

  // Map any pending assistant message to a non-pending fallback (for persistence only)
  function mapForPersistence(obj: Record<string, Message[]>) {
    const out: Record<string, Message[]> = {};
    for (const [docId, list] of Object.entries(obj)) {
      out[docId] = (list || []).map((m) =>
        m.role === "assistant" && (m as any).pending
          ? { ...m, pending: false, content: PENDING_FALLBACK }
          : m
      );
    }
    return out;
  }

  // Unified updater: updates live (UI) and writes a safe, mapped copy to storage
  function updateConversations(
    updater: (prev: Record<string, Message[]>) => Record<string, Message[]>
  ) {
    setLiveConversations((prev) => {
      const next = updater(prev);
      try {
        setPersistedConversations(mapForPersistence(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  // Keep a minimal sync from storage -> live on first mount (optional safety)
  React.useEffect(() => {
    setLiveConversations((prev) =>
      Object.keys(prev).length ? prev : persistedConversations
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  useCmdK(() => setCmdOpen((s) => !s));

  const [dragOver, setDragOver] = React.useState(false);

  // Sidebar width (desktop)
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
        if (Number.isFinite(n))
          setSidebarWidth(Math.min(MAX_W, Math.max(MIN_W, n)));
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
  }, [MIN_W, MAX_W]);

  // URL → activeId
  React.useEffect(() => {
    const q = search.get("doc");
    if (q) setActiveId(q);
  }, [search]);

  // ---------------------- fetch documents (initial/load) ----------------------
  const fetchingRef = React.useRef(false);
  const fetchDocs = React.useCallback(async () => {
    // Wait for Clerk to hydrate before deciding signed-in vs signed-out
    if (!isLoaded) return;
    if (fetchingRef.current) return; // prevent overlapping calls
    fetchingRef.current = true;
    try {
      setErrorDocs(null);
      setLoadingDocs(true); // keep skeleton visible for this definitive cycle

      if (!isSignedIn) {
        // Auth is loaded and user is signed out → show empty state (no flash)
        setDocs([]);
        return;
      }

      const raw = await apiRef.current.get(endpoints.docs.list(), {
        cache: "no-store",
      });

      // normalize to array (supports multiple shapes)
      const list: Doc[] = Array.isArray(raw)
        ? raw
        : ((raw?.items as Doc[]) ??
          (raw?.documents as Doc[]) ??
          (raw?.data as Doc[]) ??
          []);

      setDocs(list);
      setActiveId((curr) => {
        if (!curr) return null;
        return list.some((d) => d.id === curr) ? curr : null;
      });
    } catch (e: any) {
      const msg =
        typeof e?.message === "string" && e.message
          ? e.message
          : "Couldn’t load your library. Check the server & try again.";
      setErrorDocs(msg);
    } finally {
      setLoadingDocs(false);
      fetchingRef.current = false;
    }
  }, [isLoaded, isSignedIn]);

  React.useEffect(() => {
    if (isLoaded) fetchDocs();
  }, [isLoaded, fetchDocs]);

  // ------------------------------ SSE subscription ---------------------------
  const [sseConnected, setSseConnected] = React.useState(false);
  const backoffRef = React.useRef(2000); // for reconnects (2s → max 30s)

  React.useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let es: EventSource | null = null;
    let canceled = false;

    function connect() {
      if (canceled) return;
      try {
        es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
      } catch {
        scheduleReconnect();
        return;
      }

      es.addEventListener("hello", () => {
        backoffRef.current = 2000;
        setSseConnected(true);
      });

      es.addEventListener("doc", (e: MessageEvent) => {
        // server sends: { type, docId, status, pct?, stage?, error?, pages? }
        try {
          const payload = JSON.parse(e.data) as {
            type: "progress" | "completed" | "failed";
            docId: string;
            status?: Doc["status"];
            pct?: number | null;
            stage?: string | null;
            error?: string | null;
            pages?: number | null;
            createdAt?: string | null;
          };

          setDocs((prev) => {
            if (!prev?.length) return prev;
            let found = false;
            const next = prev.map((d) => {
              if (d.id !== payload.docId) return d;
              found = true;
              return {
                ...d,
                status: payload.status ?? d.status,
                pages: payload.pages ?? d.pages,
                createdAt: payload.createdAt ?? d.createdAt,
              };
            });

            if (!found) fetchDocs(); // in case of new item from another tab

            // If completed and we still don't have pages, fetch lightweight status once.
            if (
              payload.type === "completed" &&
              next.find((x) => x.id === payload.docId)?.pages == null
            ) {
              (async () => {
                try {
                  const s = (await apiRef.current.get(
                    endpoints.docs.status(payload.docId)
                  )) as {
                    id: string;
                    status: Doc["status"];
                    pages: number | null;
                  };
                  setDocs((curr) =>
                    (curr ?? []).map((d) =>
                      d.id === payload.docId
                        ? {
                            ...d,
                            status: s.status ?? d.status,
                            pages: s.pages ?? d.pages,
                          }
                        : d
                    )
                  );
                } catch {
                  /* ignore */
                }
              })();
            }

            return next;
          });
        } catch {
          /* ignore bad payloads */
        }
      });

      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        es = null;
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (canceled) return;
      const delay = Math.min(backoffRef.current, 30000);
      const t = setTimeout(() => {
        if (canceled) return;
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
        connect();
      }, delay);
      (scheduleReconnect as any)._t = t;
    }

    connect();

    return () => {
      canceled = true;
      setSseConnected(false);
      if (es) es.close();
      const t = (scheduleReconnect as any)._t as number | undefined;
      if (t) clearTimeout(t);
    };
  }, [isLoaded, isSignedIn, fetchDocs]);

  // ----------------------- fallback poll (only if needed) ---------------------
  React.useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (sseConnected) return;
    const t = setInterval(fetchDocs, 60000);
    return () => clearInterval(t);
  }, [isLoaded, isSignedIn, sseConnected, fetchDocs]);

  // --------------------------------- uploads ---------------------------------
  const selectDoc = (id: string) => setActiveId(id);

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

      const json = (await apiRef.current.upload(
        endpoints.files.upload(),
        fd
      )) as any;

      onUploaded(json?.uploaded || []);
      push(`Uploaded “${file.name}”. Processing…`);
      // SSE will drive status/pages after this
    } catch (e: any) {
      const m = String(e?.message || "");
      if (m.includes("401")) {
        push("Please sign in to upload.");
        return;
      }
      push("Upload failed. Please try again.");
    }
  }
  function openFilePicker() {
    if (!isSignedIn) {
      push("Please sign in to upload.");
      return;
    }
    fileInputRef.current?.click();
  }
  const [showUploadModal, setShowUploadModal] = React.useState(false);

  // key shortcuts: L / U
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

  // allow global open-upload events
  React.useEffect(() => {
    const open = () => setShowUploadModal(true);
    window.addEventListener("docchat:open-upload", open as EventListener);
    return () =>
      window.removeEventListener("docchat:open-upload", open as EventListener);
  }, []);

  // receive uploaded docs (optimistic add → SSE will drive status)
  function upsertById(prev: Doc[], incoming: Doc[]) {
    const map = new Map(prev.map((d) => [d.id, d]));
    for (const d of incoming) {
      const existed = map.get(d.id);
      map.set(d.id, existed ? { ...existed, ...d } : d);
    }
    return Array.from(map.values());
  }

  const onUploaded = React.useCallback(
    (uploaded: Doc[]) => {
      if (!uploaded?.length) return;
      // give new items a createdAt immediately so "x min ago" renders
      const nowIso = new Date().toISOString();
      const stamped = uploaded.map((d) =>
        d.createdAt ? d : { ...d, createdAt: nowIso }
      );
      setDocs((prev) => upsertById(prev ?? [], stamped));
      const firstId = stamped[0].id;
      setActiveId(firstId);
      updateConversations((prev) => ({ ...prev, [firstId]: [] }));
    },
    [] // updateConversations is stable in this component scope
  );

  React.useEffect(() => {
    if (activeId) router.replace(`?doc=${encodeURIComponent(activeId)}`);
  }, [activeId, router]);

  // external delete handler
  React.useEffect(() => {
    function onDeleted(e: CustomEvent<{ id: string }>) {
      const id = e?.detail?.id;
      if (!id) return;
      setDocs((prev) => (prev ?? []).filter((d) => d.id !== id));
      updateConversations((prev) => {
        const { [id]: _drop, ...rest } = prev;
        return rest as typeof prev;
      });
      setActiveId((curr) => (curr === id ? null : curr));
      push("Document deleted permanently.");
    }
    window.addEventListener("docchat:doc-deleted", onDeleted as EventListener);
    return () =>
      window.removeEventListener(
        "docchat:doc-deleted",
        onDeleted as EventListener
      );
  }, [push]);

  // chat send
  const sendMessage = async (docId: string, content: string) => {
    const addMsg = (m: Message) =>
      updateConversations((prev) => ({
        ...prev,
        [docId]: [...(prev[docId] || []), m],
      }));

    const replaceMsg = (id: string, patch: Partial<Message>) =>
      updateConversations((prev) => {
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

    const placeholderId = crypto.randomUUID();
    addMsg({
      id: placeholderId,
      role: "assistant",
      content: "",
      pending: true,
      ts: Date.now(),
    });

    try {
      const json = (await apiRef.current.post(endpoints.chat.ask(docId), {
        content,
      })) as any;

      replaceMsg(placeholderId, {
        pending: false,
        content: json?.answer ?? "I don't have a response yet.",
        ts: Date.now(),
      });
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("401")) {
        replaceMsg(placeholderId, {
          pending: false,
          content: "Please sign in to chat with this document.",
          ts: Date.now(),
        });
        push("You’re signed out.");
        return;
      }
      if (msg.includes("409")) {
        replaceMsg(placeholderId, {
          pending: false,
          content:
            "This document is still processing. I’ll be ready once it’s marked ready.",
          ts: Date.now(),
        });
        return;
      }
      replaceMsg(placeholderId, {
        pending: false,
        content: "I hit a network error. Check your internet connection.",
        ts: Date.now(),
      });
      push("Network error while chatting.");
    }
  };

  const activeDoc = docs?.find((d) => d.id === activeId) || null;

  // new chat event
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

  // focus chat with Enter (global)
  React.useEffect(() => {
    const onEnter = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        (
          document.getElementById("chat-input") as HTMLTextAreaElement | null
        )?.focus();
      }
    };
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, []);

  return (
    <>
      <ToastViewport toasts={toasts} />

      {/* While Clerk is booting, show a full-page skeleton so we don't flash the welcome card */}
      <ClerkLoading>
        <div className="min-h-screen w-full grid place-items-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl">
            <div className="h-6 w-1/2 rounded bg-white/10 animate-pulse mb-4" />
            <div className="h-10 w-full rounded bg-white/10 animate-pulse mb-3" />
            <div className="h-10 w-full rounded bg-white/10 animate-pulse mb-3" />
            <div className="h-12 w-full rounded bg-white/10 animate-pulse" />
          </div>
        </div>
      </ClerkLoading>

      <ClerkLoaded>
        {/* Signed-out experience */}
        <SignedOut>
          <div className="min-h-screen w-full grid place-items-center p-6">
            <div className="w-full max-w-md">
              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl">
                <h1 className="text-2xl font-medium mb-2 text-white">
                  Welcome to DocChat
                </h1>
                <p className="text-white/70 mb-6">
                  Sign in to upload PDFs and chat with them.
                </p>
                <SignIn
                  routing="hash"
                  afterSignInUrl="/"
                  afterSignUpUrl="/"
                  appearance={{
                    baseTheme: undefined,
                    elements: {
                      rootBox: "w-full",
                      card: "w-full bg-transparent shadow-none border-none",
                      formButtonPrimary:
                        "bg-gradient-to-r from-emerald-400 to-blue-500 text-black font-medium hover:opacity-90 shadow-lg shadow-emerald-500/20 rounded-lg",
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </SignedOut>

        {/* Signed-in experience */}
        {/* Signed-in experience */}
        <SignedIn>
          {/* Fixed header (no extra scroll above) */}
          <header className="fixed top-0 left-0 right-0 z-40 backdrop-blur-xl bg-black/10 border-b border-white/10">
            <nav className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-500 via-emerald-400 to-rose-500" />
                <span className="text-white font-medium tracking-tight">
                  DocChat
                </span>
              </div>
              <UserButton
                appearance={{
                  elements: {
                    userButtonAvatarBox:
                      "ring-2 ring-white/20 hover:ring-white/30 transition-shadow",
                    userButtonPopoverCard:
                      "bg-white/5 backdrop-blur-xl border border-white/10 text-white",
                    userButtonPopoverMain: "text-white",
                    userButtonPopoverActionButton: "hover:bg-white/10",
                  },
                }}
              />
            </nav>
          </header>

          {/* Content is pushed below the fixed header (pt-16 ~= 64px) */}
          <div className="max-w-7xl mx-auto px-4 pb-6 pt-16">
            <UploadModal
              open={showUploadModal}
              onClose={() => setShowUploadModal(false)}
              onUploaded={(uploaded: Doc[]) => {
                onUploaded(uploaded);
                setShowUploadModal(false);
              }}
              emitGlobalEvent={false}
            />

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

            <CommandPalette
              isOpen={cmdOpen}
              onClose={() => setCmdOpen(false)}
              docs={docs ?? []}
              activeId={activeId}
              onSelectDoc={(id) => {
                setActiveId(id);
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

            {/* Desktop layout
        Height = viewport - header(64 for pt-16) - bottom padding(24)
     */}
            <div className="hidden lg:flex lg:gap-4 h-[calc(100vh-64px-24px)] min-h-0">
              {/* Sidebar */}
              <aside
                className="lg:sticky lg:top-20"
                style={{ width: sidebarWidth }}
              >
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-xl h-[calc(100vh-64px-24px)] overflow-hidden">
                  <SidebarDocs
                    docs={docs}
                    loading={loadingDocs || !isLoaded}
                    activeId={activeId}
                    onSelect={(id) => setActiveId(id)}
                    onClearAll={() => {
                      setDocs([]);
                      setActiveId(null);
                      updateConversations(() => ({}));
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
                className="flex-1 min-w-0 h-[calc(100vh-64px-24px)] min-h-0 overflow-hidden flex flex-col rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl"
                onDragOver={(e) => {
                  if (activeDoc) return;
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => !activeDoc && setDragOver(false)}
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
                            href={`${API_BASE}/`}
                            target="_blank"
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm"
                          >
                            Health
                          </a>
                        </>
                      }
                    >
                      <div className="mt-1">
                        {errorDocs} Ensure{" "}
                        <code className="text-white/90">
                          NEXT_PUBLIC_API_BASE
                        </code>{" "}
                        is correct.
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
                        messages={liveConversations[activeDoc.id] || []}
                        onSend={(text) => sendMessage(activeDoc.id, text)}
                        onUploaded={onUploaded}
                      />
                    ) : (
                      <EmptyState
                        dragOver={dragOver}
                        activeDocExists={!!activeDoc}
                        onOpenFilePicker={openFilePicker}
                        onDropFile={uploadPdf}
                      />
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
                    className={`absolute inset-0 bg-black/50 ${
                      sidebarOpen ? "" : "hidden"
                    }`}
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
                      loading={loadingDocs || !isLoaded}
                      activeId={activeId}
                      onSelect={(id) => {
                        setActiveId(id);
                        setSidebarOpen(false);
                      }}
                      onClearAll={() => {
                        setDocs([]);
                        setActiveId(null);
                        updateConversations(() => ({}));
                        router.replace(``);
                      }}
                    />
                    <div className="p-4 border-t border-white/10">
                      <FileUpload onUploaded={onUploaded} />
                    </div>
                  </div>
                </div>
              </aside>

              <main className="h-[calc(100vh-64px-24px)] min-h-0 overflow-hidden flex flex-col rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                {!loadingDocs && !errorDocs && activeDoc && (
                  <ChatWindow
                    key={activeDoc.id}
                    doc={activeDoc}
                    messages={liveConversations[activeDoc.id] || []}
                    onSend={(text) => sendMessage(activeDoc.id, text)}
                    onUploaded={onUploaded}
                  />
                )}
              </main>
            </div>
          </div>
        </SignedIn>
      </ClerkLoaded>
    </>
  );
}
