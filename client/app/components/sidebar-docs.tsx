"use client";

import * as React from "react";
import {
  FileText,
  Trash2,
  X,
  Search,
  ChevronDown,
  Upload,
  Check,
  Loader2,
  Star,
  StarOff,
} from "lucide-react";
import type { Doc } from "@/app/types";
import { useApi, endpoints } from "../lib/api-client";

/* --------------------------------- utils --------------------------------- */
function normalize(v: unknown) {
  return String(v ?? "").toLowerCase().trim();
}
function timeAgo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const dys = Math.floor(h / 24);
  if (dys > 7) return d.toLocaleDateString();
  if (dys >= 1) return `${dys}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return `${s}s ago`;
}
function useDebounced<T>(value: T, delay = 150) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
function statusRank(s?: string) {
  const v = (s || "ready").toLowerCase();
  if (v === "queued") return 0;
  if (v === "processing") return 1;
  if (v === "ready") return 2;
  return 3; // error last
}

/* ---------------------------- favourites hook ---------------------------- */
function useFavourites() {
  const KEY = "docchat:favs";
  const [favs, setFavs] = React.useState<Set<string>>(new Set());

  // load once
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setFavs(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  // persist
  React.useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(Array.from(favs)));
    } catch {}
  }, [favs]);

  // listen for deletions (id or '*' for all)
  React.useEffect(() => {
    const onDeleted = (e: any) => {
      const id = e?.detail?.id;
      if (!id) return;
      if (id === "*") {
        setFavs(new Set());
      } else if (favs.has(id)) {
        const next = new Set(favs);
        next.delete(id);
        setFavs(next);
      }
    };
    window.addEventListener("docchat:doc-deleted", onDeleted as EventListener);
    return () =>
      window.removeEventListener("docchat:doc-deleted", onDeleted as EventListener);
  }, [favs]);

  const isFav = React.useCallback((id: string) => favs.has(id), [favs]);
  const toggle = React.useCallback((id: string) => {
    setFavs((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  return { isFav, toggle, favs };
}

/* -------------------------------- skeleton -------------------------------- */
function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <ul className="px-2 space-y-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="animate-pulse">
          <div className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
            <div className="h-7 w-7 rounded-lg bg-white/10 border border-white/10" />
            <div className="flex-1 min-w-0">
              <div className="h-3.5 w-2/3 bg-white/10 rounded mb-1.5" />
              <div className="h-2.5 w-1/3 bg-white/10 rounded" />
            </div>
            <div className="h-5 w-16 rounded-full bg-white/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------- component -------------------------------- */
type Props = {
  /** now tolerant: pass undefined/null while fetching to keep skeleton up */
  docs?: Doc[] | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClearAll: () => void;
  /** still supported; if omitted, we auto-infer loading when !docs */
  loading?: boolean;
};

export default function SidebarDocs({
  docs,
  activeId,
  onSelect,
  onClearAll,
  loading: loadingProp = false,
}: Props) {
  const api = useApi();
  const loading = loadingProp || docs == null; // keep skeleton until docs materialize

  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "favourites" | "ready" | "processing" | "queued" | "error"
  >("all");
  const [sort, setSort] = React.useState<"recent" | "alpha">("recent");
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);

  // bulk delete UI state
  const [deletingAll, setDeletingAll] = React.useState(false);
  const [deleteMsg, setDeleteMsg] = React.useState<string | null>(null);

  // confirm dialog state (replaces window.confirm)
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const confirmPrimaryRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => confirmPrimaryRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [confirmOpen]);

  const uniqueDocs = React.useMemo(() => {
    const seen = new Set<string>();
    const out: Doc[] = [];
    for (const d of docs || []) {
      if (!d?.id) continue;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
    return out;
  }, [docs]);

  const listRef = React.useRef<HTMLUListElement | null>(null);
  const sortBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const sortMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [highlightIdx, setHighlightIdx] = React.useState<number>(-1);

  const { isFav, toggle: toggleFav, favs } = useFavourites();

  const debouncedQ = useDebounced(q, 150);
  const deferredQ = React.useDeferredValue(debouncedQ);

  const filteredSorted = React.useMemo(() => {
    const s = normalize(deferredQ);

    let result = uniqueDocs.filter((d) => {
      const matchesQ =
        !s ||
        normalize(d?.name).includes(s) ||
        normalize(d?.status).includes(s);
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "favourites"
          ? isFav(d.id)
          : (d.status ?? "ready").toLowerCase() === statusFilter;
      return matchesQ && matchesStatus;
    });

    if (sort === "alpha") {
      result = [...result].sort((a, b) => {
        const sr = statusRank(a.status) - statusRank(b.status);
        if (sr !== 0) return sr;
        return (a.name || "").localeCompare(b.name || "");
      });
    } else {
      result = [...result].sort((a, b) => {
        const sr = statusRank(a.status) - statusRank(b.status);
        if (sr !== 0) return sr;
        const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (bd !== ad) return bd - ad;
        return (a.name || "").localeCompare(b.name || "");
      });
    }

    return result;
  }, [uniqueDocs, deferredQ, statusFilter, sort, isFav]);

  React.useEffect(() => setHighlightIdx(-1), [deferredQ, statusFilter, sort]);

  // keyboard navigation
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const typing =
        !!ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      if (typing) return;
      if (filteredSorted.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filteredSorted.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && highlightIdx >= 0) {
        e.preventDefault();
        const pick = filteredSorted[highlightIdx];
        if (pick) onSelect(pick.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredSorted, highlightIdx, onSelect]);

  // keep highlighted in view
  React.useEffect(() => {
    if (highlightIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `li[data-idx="${highlightIdx}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  // close sort menu on outside click / Escape
  React.useEffect(() => {
    if (!sortMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (sortMenuRef.current?.contains(t) || sortBtnRef.current?.contains(t)) {
        return;
      }
      setSortMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [sortMenuOpen]);

  // open upload via global input or modal
  const tryOpenUpload = React.useCallback(() => {
    const input = document.getElementById(
      "global-upload"
    ) as HTMLInputElement | null;
    if (input) input.click();
    else window.dispatchEvent(new CustomEvent("docchat:open-upload"));
  }, []);

  // ----------------------------- BULK DELETE (one API call) -----------------
  const bulkDeleteAll = React.useCallback(async () => {
    if (deletingAll) return;
    const count = (uniqueDocs || []).length;
    if (count === 0) return;

    setDeletingAll(true);
    setDeleteMsg("Deleting all documents…");

    try {
      const res = (await api.del(endpoints.docs.removeAll())) as any;
      const removed = Number(res?.deletedCount ?? 0);

      // Broadcast a general wipe
      window.dispatchEvent(
        new CustomEvent("docchat:doc-deleted", { detail: { id: "*" } })
      );

      // Clear local state (docs + localStorage chats) via parent callback
      onClearAll();

      setDeleteMsg(`Deleted ${removed} document${removed === 1 ? "" : "s"}.`);
      setTimeout(() => setDeleteMsg(null), 1600);
    } catch (e: any) {
      setDeleteMsg("Delete failed. Please try again.");
      setTimeout(() => setDeleteMsg(null), 2000);
    } finally {
      setDeletingAll(false);
      setConfirmOpen(false);
    }
  }, [api, uniqueDocs, deletingAll, onClearAll]);

  return (
    <div className="h-full flex flex-col backdrop-blur-xl">
      {/* Search + sort + filters */}
      <div className="p-3 border-b border-white/10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 min-w-0">
            <div className="flex items-center w-full rounded-full bg-white/[0.07] border border-white/10 focus-within:ring-2 focus-within:ring-emerald-400/30 focus-within:border-emerald-300/30 transition-shadow">
              <Search
                size={16}
                className="ml-3 text-white/60 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && q) setQ("");
                }}
                placeholder="Search documents…"
                className="doc-search-input flex-1 min-w-0 px-2 py-2 bg-transparent text-white/90 placeholder:text-white/50 outline-none truncate appearance-none"
                aria-label="Search documents"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  className="mr-2 p-1 rounded hover:bg-white/10 flex items-center justify-center"
                >
                  <X size={16} className="text-white/70" />
                </button>
              )}
            </div>
          </div>

          <div className="relative shrink-0 self-start sm:self-auto">
            <button
              ref={sortBtnRef}
              onClick={() => setSortMenuOpen((s) => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                   text-white/90 border border-white/10
                   bg-white/[0.08] hover:bg-white/[0.12]
                   backdrop-blur-md transition-colors
                   focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
              aria-controls="sort-menu"
            >
              <span className="text-xs font-medium hidden xs:inline">
                {sort === "recent" ? "Recent" : "A–Z"}
              </span>
              <ChevronDown
                size={14}
                className={`transition-transform ${sortMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {sortMenuOpen && (
              <div
                ref={sortMenuRef}
                id="sort-menu"
                role="menu"
                aria-label="Sort options"
                className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10
                     bg-neutral-800/95 text-white/90 shadow-2xl z-30"
              >
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-white/50">
                  Sort by
                </div>
                <div className="py-1">
                  <button
                    role="menuitemradio"
                    aria-checked={sort === "recent"}
                    className={[
                      "w-full flex items-center justify-between gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                      sort === "recent"
                        ? "bg-emerald-500/20 text-emerald-100 border border-emerald-400/30"
                        : "text-white/85 hover:bg-black hover:text-white",
                    ].join(" ")}
                    onClick={() => {
                      setSort("recent");
                      setSortMenuOpen(false);
                    }}
                  >
                    <span>Recent</span>
                    {sort === "recent" && (
                      <Check size={16} className="text-emerald-300" />
                    )}
                  </button>

                  <button
                    role="menuitemradio"
                    aria-checked={sort === "alpha"}
                    className={[
                      "w-full flex items-center justify-between gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                      sort === "alpha"
                        ? "bg-emerald-500/20 text-emerald-100 border border-emerald-400/30"
                        : "text-white/85 hover:bg-black hover:text-white",
                    ].join(" ")}
                    onClick={() => {
                      setSort("alpha");
                      setSortMenuOpen(false);
                    }}
                  >
                    <span>A–Z</span>
                    {sort === "alpha" && (
                      <Check size={16} className="text-emerald-300" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* row 2: status + favourites chips */}
        <div className="mt-3 -mx-1 flex flex-row flex-wrap gap-2 px-1 overflow-x-auto sm:overflow-visible">
          {(["all", "favourites", "ready", "processing", "queued", "error"] as const).map(
            (k) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={[
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs border transition-colors whitespace-nowrap",
                  statusFilter === k
                    ? "bg-emerald-400/15 border-emerald-400/30 text-emerald-100"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10",
                ].join(" ")}
                title={k === "favourites" ? "Show only favourite docs" : undefined}
              >
                {k === "favourites" ? (
                  <>
                    <Star size={12} className="inline-block" /> Favourites
                    {favs.size > 0 && (
                      <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] bg-white/10">
                        {favs.size}
                      </span>
                    )}
                  </>
                ) : (
                  k[0].toUpperCase() + k.slice(1)
                )}
              </button>
            )
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2" aria-busy={loading}>
        {loading ? (
          <SkeletonList />
        ) : filteredSorted.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
              <FileText className="text-white/70" size={18} />
            </div>
            <div className="text-white/85 font-medium">No documents found</div>
            <div className="text-white/60 text-sm mt-1">
              Try uploading a file or adjusting your search/filter.
            </div>
          </div>
        ) : (
          <ul ref={listRef} className="px-2 space-y-2">
            {filteredSorted.map((doc, i) => {
              const isActive = activeId === doc.id;
              const isHighlighted = highlightIdx === i;
              const fav = isFav(doc.id);
              return (
                <li key={doc.id} data-idx={i}>
                  <div
                    className={[
                      "group w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all border",
                      isActive
                        ? "bg-gradient-to-r from-sky-500/20 to-indigo-500/30 border border-sky-400/30 ring-1 ring-sky-400/30"
                        : isHighlighted
                        ? "bg-white/10 border-white/20"
                        : "bg-white/5 hover:bg-white/8 border-white/10",
                    ].join(" ")}
                  >
                    <button
                      onClick={() => onSelect(doc.id)}
                      className="flex-1 min-w-0 flex items-center gap-3"
                      title={doc.name}
                    >
                      <div
                        className={[
                          "shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg border",
                          isActive
                            ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                            : "border-white/10 bg-white/5 text-white/80",
                        ].join(" ")}
                      >
                        <FileText size={16} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          className={[
                            "text-sm font-medium",
                            isActive ? "text-emerald-100" : "text-white",
                            deferredQ
                              ? "whitespace-normal line-clamp-2"
                              : "truncate",
                          ].join(" ")}
                        >
                          <Highlight
                            text={String(doc?.name ?? "")}
                            query={deferredQ}
                          />
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/60 truncate">
                          {doc.pages
                            ? `${doc.pages} page${doc.pages > 1 ? "s" : ""}`
                            : "PDF"}
                          {doc.createdAt ? ` • ${timeAgo(doc.createdAt)}` : ""}
                        </p>
                      </div>

                      <div className="ml-auto">
                        <StatusChip status={doc.status ?? "ready"} />
                      </div>
                    </button>

                    {/* favourite toggle */}
                    <button
                      className={[
                        "ml-2 shrink-0 p-2 rounded-lg border transition",
                        fav
                          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
                      ].join(" ")}
                      title={fav ? "Remove from favourites" : "Add to favourites"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFav(doc.id);
                      }}
                      aria-pressed={fav}
                    >
                      {fav ? <Star size={16} /> : <StarOff size={16} />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-2">
          <button
            onClick={tryOpenUpload}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
             bg-gradient-to-r from-emerald-500/90 to-emerald-600/90
             hover:from-emerald-500 hover:to-emerald-600
             text-white font-medium border border-emerald-400/30
             shadow-lg shadow-emerald-500/20 transition-colors"
            title="Upload a PDF"
          >
            <Upload size={16} />
            Upload
          </button>

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={deletingAll || (uniqueDocs?.length ?? 0) === 0}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-rose-400/30 text-rose-200 
              hover:bg-rose-400/10 disabled:opacity-60"
            title="Permanently delete all documents"
            aria-live="polite"
          >
            {deletingAll ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {deleteMsg || "Deleting…"}
              </>
            ) : (
              <>
                <Trash2 size={16} />
                Clear
              </>
            )}
          </button>
        </div>
        {deleteMsg && (
          <div className="mt-2 text-[11px] text-white/60" aria-live="polite">
            {deleteMsg}
          </div>
        )}
      </div>

      {/* ----------------------- Confirm Delete Modal ----------------------- */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-desc"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deletingAll && setConfirmOpen(false)}
          />
          {/* Panel */}
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/95 shadow-2xl">
              <div className="flex items-start gap-3 p-4 border-b border-white/10">
                <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-400/30 bg-rose-400/10 text-rose-200">
                  <Trash2 size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="confirm-title" className="text-white font-medium">
                    Delete all documents?
                  </h2>
                  <p id="confirm-desc" className="text-white/70 text-sm mt-1">
                    This will permanently remove{" "}
                    <strong>{uniqueDocs?.length ?? 0}</strong> document
                    {(uniqueDocs?.length ?? 0) === 1 ? "" : "s"} and clear the chats.
                    This action cannot be undone.
                  </p>
                </div>
                <button
                  className="p-2 rounded-lg hover:bg-white/10 text-white/70"
                  onClick={() => setConfirmOpen(false)}
                  aria-label="Close dialog"
                  disabled={deletingAll}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 flex items-center justify-end gap-2">
                <button
                  className="px-3 py-2 rounded-lg border border-white/10 text-white/85 hover:bg-white/10"
                  onClick={() => setConfirmOpen(false)}
                  disabled={deletingAll}
                >
                  Cancel
                </button>
                <button
                  ref={confirmPrimaryRef}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg 
                    bg-gradient-to-r from-rose-500/90 to-rose-600/90
                    hover:from-rose-500 hover:to-rose-600
                    text-white font-medium border border-rose-400/30
                    disabled:opacity-60"
                  onClick={bulkDeleteAll}
                  disabled={deletingAll}
                >
                  {deletingAll ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Delete all
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* --------------------- /Confirm Delete Modal ---------------------- */}
    </div>
  );
}

/* --------------------------------- sub UI --------------------------------- */
function StatusChip({
  status,
}: {
  status: NonNullable<Doc["status"]> | "ready";
}) {
  const map: Record<string, string> = {
    queued: "bg-amber-400/15 text-amber-200 border border-amber-400/30",
    processing: "bg-sky-400/15 text-sky-200 border border-sky-400/30",
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
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${map[status]}`}
    >
      <span className="leading-none">{label}</span>
      {status === "processing" && (
        <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      )}
    </span>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="bg-white/20 text-white rounded px-0.5">{match}</mark>
      {after}
    </>
  );
}
