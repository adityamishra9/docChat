"use client";

import * as React from "react";
import { FileText, Trash2 } from "lucide-react";
import type { Doc } from "../page";

type Props = {
  docs: Doc[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClearAll: () => void;
};

export default function SidebarDocs({ docs, activeId, onSelect, onClearAll }: Props) {
  const [q, setQ] = React.useState("");

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return docs;
    return docs.filter((d) => d.name.toLowerCase().includes(s));
  }, [docs, q]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-white/10">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search documents..."
          className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-white/50 outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-white/60">No documents</div>
        ) : (
          <ul className="px-2 space-y-1">
            {filtered.map((doc) => (
              <li key={doc.id}>
                <button
                  onClick={() => onSelect(doc.id)}
                  className={[
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left",
                    activeId === doc.id
                      ? "bg-white/15 border border-white/20"
                      : "hover:bg-white/10 border border-transparent",
                  ].join(" ")}
                >
                  <FileText size={18} className="text-emerald-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-white text-sm">{doc.name}</p>
                    <div className="mt-1">
                      <StatusChip status={doc.status ?? "ready"} />
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-3 border-t border-white/10">
        <button
          onClick={onClearAll}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/10"
        >
          <Trash2 size={16} />
          Clear list (local)
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: NonNullable<Doc["status"]> | "ready" }) {
  const map: Record<string, string> = {
    queued:
      "bg-amber-400/15 text-amber-200 border border-amber-400/30",
    processing:
      "bg-blue-400/15 text-blue-200 border border-blue-400/30",
    ready:
      "bg-emerald-400/15 text-emerald-200 border border-emerald-400/30",
    error:
      "bg-rose-400/15 text-rose-200 border border-rose-400/30",
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
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${map[status]}`}>
      <span className="leading-none">{label}</span>
      {status === "processing" && (
        <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      )}
    </span>
  );
}