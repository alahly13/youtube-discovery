import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/format";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("research-surface p-5", className)} {...props} />;
}

export function CardHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        {eyebrow ? <p className="mb-1 font-mono text-xs uppercase text-muted">{eyebrow}</p> : null}
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}
