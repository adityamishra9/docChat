"use client";

import * as React from "react";
import { Search } from "lucide-react";
import StatusChip from "./ui/status-chip";

export type Doc = {
  id: string;
  name: string;
  pages?: number;
  status?: "queued" | "processing" | "ready" | "error";
  createdAt?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  docs: Doc[];
  activeId: string | null;
  onSelectDoc: (id: string) => void;
};

export default function CommandPalette({
  isOpen,
  onClose,
  docs,
  activeId,
  onSelectDoc,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const results = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = !s ? docs : docs.filter((d) => d.name.toLowerCase().includes(s));
    return filtered.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  }, [docs, q, activeId]);

  React.useEffect(() => {
    if (!isOpen) return;
    const scrollIntoView = () => {
      const item = listRef.current?.querySelector<HTMLLIElement>(`li[data-idx="${idx}"]`);
      item?.scrollIntoView({ block: "nearest" });
    };
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

        <ul ref={listRef} className="max-h-80 overflow-auto p-2" role="listbox" aria-label="Documents">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-white/60">No matching documents</li>
          ) : (
            results.map((d, i) => (
              <li
                key={d.id}
                data-idx={i}
                role="option"
                aria-selected={i === idx}
                className={[
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-2 cursor-pointer",
                  i === idx ? "bg-white/15 border border-white/20" : "hover:bg-white/10",
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
                    {d.createdAt ? ` • ${new Date(d.createdAt).toLocaleString()}` : ""}
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
