"use client";

import { AlertTriangle, Info, CheckCircle2, XCircle } from "lucide-react";
import * as React from "react";

type Variant = "info" | "warning" | "error" | "success";
type Tone = "soft" | "solid";

const Icon: Record<Variant, React.ComponentType<any>> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
};

// subtle/translucent (old look, default), kept for places like inline banners
const softStyles: Record<Variant, string> = {
  info:    "bg-white/6  text-white/90  border border-white/12 backdrop-blur-sm",
  warning: "bg-amber-400/10  text-amber-100  border border-amber-400/30",
  error:   "bg-rose-400/10   text-rose-100   border border-rose-400/30",
  success: "bg-emerald-400/10 text-emerald-100 border border-emerald-400/30",
};

// opaque, elevated (new look for toasts/overlays)
const solidStyles: Record<Variant, string> = {
  info:    "bg-neutral-900/95 text-white border border-white/10 shadow-2xl shadow-black/30",
  warning: "bg-amber-900/85  text-amber-50  border border-amber-400/30 shadow-2xl shadow-amber-900/20",
  error:   "bg-rose-900/85   text-rose-50   border border-rose-400/30 shadow-2xl shadow-rose-900/20",
  success: "bg-emerald-900/85 text-emerald-50 border border-emerald-400/30 shadow-2xl shadow-emerald-900/20",
};

export function Alert({
  variant = "info",
  tone = "soft",
  title,
  children,
  actions,
  className = "",
  role = "status",
  "aria-live": ariaLive = "polite",
}: {
  variant?: Variant;
  tone?: Tone; // 👈 NEW
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  role?: React.AriaRole;
  "aria-live"?: "off" | "polite" | "assertive";
}) {
  const Ico = Icon[variant];
  const toneStyles = tone === "solid" ? solidStyles[variant] : softStyles[variant];

  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={`rounded-xl p-4 ${toneStyles} ${className}`}
    >
      <div className="flex items-start gap-3">
        <Ico size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {title && <h3 className="text-sm font-medium leading-6">{title}</h3>}
          {children && <div className="text-sm/6 opacity-90">{children}</div>}
        </div>
        {actions && <div className="shrink-0 flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export default Alert;