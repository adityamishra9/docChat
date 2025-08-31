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
import StatusChip from "./components/ui/status-chip";
import EmptyState from "./components/empty-state";

import { useToasts, ToastViewport } from "./components/ui/use-toasts";
import { useLocalStorageState } from "./lib/use-localstorage";
import { useCmdK } from "./lib/use-cmdk";
import { useAuth, SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { API_BASE, useApi, endpoints } from "./lib/api-client";

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
  pending?: boolean;
};

export default function AppHome() {
  const router = useRouter();
  const search = useSearchParams();
  const { toasts, push } = useToasts();
  const { isSignedIn } = useAuth();

  // ⚠️ important: keep a stable ref to the api instance
  const api = useApi();
  const apiRef = React.useRef(api);
  React.useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = React.useState(true);
  const [errorDocs, setErrorDocs] = React.useState<string | null>(null);

  const [conversations, setConversations] = useLocalStorageState<
    Record<string, Message[]>
  >("docchat:conversations", {});

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

  // ------------------------- fetch documents -------------------------
  const fetchingRef = React.useRef(false);
  const fetchDocs = React.useCallback(async () => {
    if (fetchingRef.current) return; // prevent overlapping calls
    fetchingRef.current = true;
    try {
      setErrorDocs(null);
      if (!isSignedIn) {
        setDocs([]);
        setLoadingDocs(false);
        return;
      }

      const raw = await apiRef.current.get(endpoints.docs.list(), {
        cache: "no-store",
      });

      // normalize to array
      const list: Doc[] = Array.isArray(raw)
        ? raw
        : (raw?.documents as Doc[]) ??
          (raw?.items as Doc[]) ??
          (raw?.data as Doc[]) ??
          [];

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
  }, [isSignedIn]); // <-- only depends on auth status (api comes via ref)

  React.useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // poll while processing (every 4s, no thrash)
  React.useEffect(() => {
    const needsPoll = docs.some((d) => d.status && d.status !== "ready");
    if (!needsPoll) return;
    const t = setInterval(fetchDocs, 4000);
    return () => clearInterval(t);
  }, [docs, fetchDocs]);

  const selectDoc = (id: string) => setActiveId(id);

  // uploads
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

  // receive uploaded docs
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
      setDocs((prev) => upsertById(prev, uploaded));
      const firstId = uploaded[0].id;
      setActiveId(firstId);
      setConversations((prev) => ({ ...prev, [firstId]: [] }));
    },
    [setConversations]
  );

  React.useEffect(() => {
    if (activeId) router.replace(`?doc=${encodeURIComponent(activeId)}`);
  }, [activeId, router]);

  // external delete handler
  React.useEffect(() => {
    function onDeleted(e: CustomEvent<{ id: string }>) {
      const id = e?.detail?.id;
      if (!id) return;
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setConversations((prev) => {
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
        content:
          "I hit a network error. Check your internet connection.",
        ts: Date.now(),
      });
      push("Network error while chatting.");
    }
  };

  const activeDoc = docs.find((d) => d.id === activeId) || null;

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
    <div className="max-w-7xl mx-auto px-4 pb-8 pt-6">
      <ToastViewport toasts={toasts} />
      <SignedOut>
        <div className="mb-4">
          <Alert
            variant="warning"
            title="You’re signed out"
            actions={
              <SignInButton mode="modal">
                <button className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm">
                  Sign in
                </button>
              </SignInButton>
            }
          >
            <div className="mt-1">
              Sign in with Clerk to view your documents, upload PDFs, and chat.
            </div>
          </Alert>
        </div>
      </SignedOut>

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
              <SignedIn>
                <FileUpload onUploaded={onUploaded} />
              </SignedIn>
              <SignedOut>
                <div className="text-xs text-white/60">
                  Sign in to enable uploads.
                </div>
              </SignedOut>
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
                  <code className="text-white/90">NEXT_PUBLIC_API_BASE</code> is
                  correct.
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
                <SignedIn>
                  <FileUpload onUploaded={onUploaded} />
                </SignedIn>
                <SignedOut>
                  <div className="text-xs text-white/60">
                    Sign in to enable uploads.
                  </div>
                </SignedOut>
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
              onUploaded={onUploaded}
            />
          )}
        </main>
      </div>
    </div>
  );
}
