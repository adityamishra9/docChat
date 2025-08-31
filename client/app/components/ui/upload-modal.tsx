"use client";

import * as React from "react";
import { X, FileUp } from "lucide-react";
import { useApi, endpoints } from "../../lib/api-client";
import { Doc, UploadModalProps } from "@/app/types";

export default function UploadModal({
  open,
  onClose,
  onSelect,
  onUploaded,
  emitGlobalEvent = false,
  title = "Upload a file",
  accept = "application/pdf",
  helperText = "Only .pdf files are supported",
}: UploadModalProps) {
  const [dragOver, setDragOver] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const api = useApi();

  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  function fileMatchesAccept(file: File, accept: string | undefined) {
    if (!accept) return true;

    const mime = (file.type || "").toLowerCase();
    const ext = file.name.toLowerCase().split(".").pop();
    const patterns = accept.split(",").map((s) => s.trim().toLowerCase());

    return patterns.some((pat) => {
      if (pat.includes("/")) {
        const [type, sub] = pat.split("/");
        if (!type || !sub) return false;
        if (sub === "*") return mime.startsWith(`${type}/`);
        return mime === pat;
      }
      if (pat.startsWith(".")) return `.${ext}` === pat;
      return false;
    });
  }

  async function handleFile(file: File) {
    if (onSelect) {
      await onSelect(file);
      return;
    }
    if (!onUploaded) return;

    if (!file || (accept && !fileMatchesAccept(file, accept))) {
      setStatus(`Unsupported file type. Expected ${accept}`);
      return;
    }

    try {
      setStatus(`Uploading “${file.name}”…`);
      const fd = new FormData();
      fd.append("pdf", file);

      const json = (await api.upload(
        endpoints.files.upload(),
        fd
      )) as any;

      const uploaded: Doc[] = json?.uploaded || [];

      setStatus(`Uploaded “${file.name}”.`);

      onUploaded(uploaded);

      if (emitGlobalEvent) {
        window.dispatchEvent(
          new CustomEvent("docchat:uploaded", { detail: uploaded })
        );
      }

      onClose();
    } catch (e: any) {
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
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
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
