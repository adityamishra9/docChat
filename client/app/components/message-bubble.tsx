"use client";

import * as React from "react";
import type { Message } from "@/app/types";

export default function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-emerald-400 text-black shadow-[0_0_0_1px_rgba(255,255,255,0.2)]"
            : "bg-white/10 text-white border border-white/10 backdrop-blur",
        ].join(" ")}
      >
        {msg.content}
        <div className={`mt-1 text-[10px] ${isUser ? "text-black/70" : "text-white/50"}`}>
          {new Date(msg.ts).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
