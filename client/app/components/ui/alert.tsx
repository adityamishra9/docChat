"use client";

import {
  XCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

type Variant = "info" | "warning" | "error" | "success";

const styles: Record<Variant, string> = {
  info: "bg-white/6 text-white/90 border border-white/12",
  warning: "bg-amber-400/10 text-amber-100 border border-amber-400/30",
  error: "bg-rose-400/10 text-rose-100 border border-rose-400/30",
  success: "bg-emerald-400/10 text-emerald-100 border border-emerald-400/30",
};

const Icon: Record<Variant, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
};

export function Alert({
  variant = "info",
  title,
  children,
  actions,
}: {
  variant?: Variant;
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode; // buttons, links, etc.
}) {
  const Ico = Icon[variant];
  return (
    <div className={`rounded-xl p-4 ${styles[variant]}`}>
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
