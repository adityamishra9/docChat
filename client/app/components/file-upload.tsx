"use client";

import * as React from "react";
import { Upload, Loader2 } from "lucide-react";
import type { Doc } from "../page";
import { useApi, endpoints } from "../lib/api-client";

type Props = {
  onUploaded: (docs: Doc[]) => void;
  inputId?: string; // optional external label control
};

export default function FileUpload({ onUploaded, inputId }: Props) {
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const api = useApi();

  const handleFiles = async (files: FileList) => {
    const pdfs = Array.from(files).filter((f) => f.type === "application/pdf");
    if (!pdfs.length) return;

    setBusy(true);
    const created: Doc[] = [];

    for (const pdf of pdfs) {
      const form = new FormData();
      form.append("pdf", pdf);

      try {
        // Expecting: { uploaded: [{ id, name, status }] }
        const json = (await api.upload(
          endpoints.files.upload(),
          form
        )) as any;

        const items: Doc[] =
          json?.uploaded?.map(
            (u: { id: string; name?: string; status?: Doc["status"] }) => ({
              id: u.id,
              name: u.name ?? pdf.name,
              status: u.status ?? "queued",
              createdAt: new Date().toISOString(),
            })
          ) ?? [];

        created.push(...items);
      } catch {
        // Show at least the local record if backend fails
        created.push({
          id: crypto.randomUUID(),
          name: pdf.name,
          status: "error",
          createdAt: new Date().toISOString(),
        });
      }
    }

    onUploaded(created);
    setBusy(false);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
      }}
      className={[
        "group relative rounded-xl border border-dashed p-4",
        dragOver
          ? "border-emerald-400 bg-emerald-400/5"
          : "border-white/15 bg-white/5",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        id={inputId || "pdf-upload"}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          // reset so same file can be reselected
          e.currentTarget.value = "";
        }}
      />

      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/10 hover:bg-white/20 text-white disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Upload size={18} />
          )}
          {busy ? "Uploading..." : "Select PDFs"}
        </button>
        <span className="text-white/60 text-sm">
          or drag & drop multiple files here
        </span>
      </div>
    </div>
  );
}
