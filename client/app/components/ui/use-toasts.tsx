"use client";
import * as React from "react";

export type Toast = { id: string; text: string };

export function useToasts() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = (text: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2600);
  };
  return { toasts, push };
}

export function ToastViewport({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-xl border border-white/10 bg-white/10 backdrop-blur-xl px-4 py-2 text-white shadow-2xl"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
