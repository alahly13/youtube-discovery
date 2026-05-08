import type { ReactNode } from "react";
import { cn } from "@/lib/utils/format";

type BadgeTone = "neutral" | "primary" | "ai" | "success" | "warning" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-muted text-muted",
  primary: "border-primary/30 bg-primary-soft text-primary dark:bg-primary-soft/40",
  ai: "border-ai/30 bg-ai-soft text-ai dark:bg-ai-soft/35",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
