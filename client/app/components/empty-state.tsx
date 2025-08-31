"use client";

import * as React from "react";

type Props = {
  dragOver: boolean;
  onOpenFilePicker: () => void;
  onDropFile: (file: File) => Promise<void>;
  activeDocExists: boolean;
};

export default function EmptyState({ dragOver, onOpenFilePicker, onDropFile, activeDocExists }: Props) {
  return (
    <div
      className="relative h-full w-full p-6 flex flex-col items-center justify-center text-center"
      onDragOver={(e) => {
        if (activeDocExists) return;
        e.preventDefault();
      }}
      onDrop={async (e) => {
        if (activeDocExists) return;
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) await onDropFile(file);
      }}
    >
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

      <h2 className="text-2xl sm:text-3xl font-semibold text-white">Start a Conversation</h2>
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
          dragOver ? "border-emerald-400 bg-emerald-400/10" : "border-white/15 hover:border-white/25 bg-white/5 hover:bg-white/10",
        ].join(" ")}
      >
        <div className="flex items-center justify-center gap-3 text-white/75">
          <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-80" aria-hidden="true">
            <path fill="currentColor" d="M12 2l5 5h-3v6h-4V7H7l5-5zm8 18H4v-6H2v8h20v-8h-2v6z" />
          </svg>
          <span className="text-sm">Drag & drop your PDF anywhere in this area</span>
        </div>
      </div>

      <div className="mt-6">
        <button
          onClick={onOpenFilePicker}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-black font-medium shadow-2xl shadow-emerald-500/20"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
          Upload a PDF
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/55">
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1 rounded bg-white/10 border border-white/10">⌘K</kbd> switch documents
        </span>
        <span>•</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1 rounded bg-white/10 border border-white/10">Enter</kbd> send
        </span>
        <span>•</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1 rounded bg-white/10 border border-white/10">Shift</kbd>+<kbd className="px-1 rounded bg-white/10 border border-white/10">Enter</kbd> newline
        </span>
      </div>
    </div>
  );
}
