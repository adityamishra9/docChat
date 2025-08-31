"use client";

import * as React from "react";
import { X, FileUp } from "lucide-react";
import { useAuth } from "@clerk/nextjs";

export type Doc = {
  id: string;
  name: string;
  size?: number;
  pages?: number;
  status?: "queued" | "processing" | "ready" | "error";
  createdAt?: string;
};

export type UploadModalProps = {
  open: boolean;
  onClose: () => void;

  onSelect?: (file: File) => void | Promise<void>;
  onUploaded?: (uploaded: Doc[]) => void;

  title?: string;
  accept?: string;
  helperText?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function UploadModal({
  open,
  onClose,
  onSelect,
  onUploaded,
  title = "Upload a file",
  accept = "application/pdf",
  helperText = "Only .pdf files are supported",
}: UploadModalProps) {
  const [dragOver, setDragOver] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const { isLoaded, getToken } = useAuth();

  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  async function handleFile(file: File) {
    if (onSelect) {
      await onSelect(file);
      return;
    }
    if (!onUploaded) return;

    if (!file || (accept && !file.type.match(accept.replace("*", ".*")))) {
      setStatus(`Unsupported file type. Expected ${accept}`);
      return;
    }
    if (!isLoaded) {
      setStatus("Auth is still loading…");
      return;
    }

    try {
      setStatus(`Uploading “${file.name}”…`);
      const token = await getToken();
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(`${API_BASE}/upload/pdf`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const uploaded: Doc[] = json?.uploaded || [];
      setStatus(`Uploaded “${file.name}”.`);
      onUploaded(uploaded);
      window.dispatchEvent(new CustomEvent("docchat:uploaded", { detail: uploaded }));
      onClose();
    } catch (e) {
      setStatus("Upload failed. Please try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="text-white/90 text-sm font-medium">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-white/70"
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="p-6"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await handleFile(file);
          }}
        >
          <label
            onClick={() => inputRef.current?.click()}
            className={[
              "block cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver
                ? "border-emerald-400 bg-emerald-400/10"
                : "border-white/15 hover:border-white/25 bg-white/5 hover:bg-white/8",
            ].join(" ")}
          >
            <div className="flex flex-col items-center gap-3">
              <FileUp size={40} className="text-white/80" />
              <div className="text-white/90 font-medium">Drag & drop here</div>
              <div className="text-xs text-white/60">
                or <span className="underline">click to select a file</span>
              </div>
              <div className="text-[11px] text-white/50 mt-2">{helperText}</div>
            </div>
          </label>

          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                await handleFile(file);
                e.currentTarget.value = "";
              }
            }}
          />

          {status && <div className="mt-4 text-xs text-white/70">{status}</div>}
        </div>

        <div className="px-6 pb-6 text-[11px] text-white/60">
          Pro tip: you can also drop a file straight into the chat.
        </div>
      </div>
    </div>
  );
}
