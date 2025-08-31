"use client";
import * as React from "react";

export type Status = "queued" | "processing" | "ready" | "error";

/** Pill used in lists and the command palette */
export default function StatusChip({ status }: { status: Status | "ready" }) {
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
    <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${map[status]}`}>
      {label}
    </span>
  );
}
