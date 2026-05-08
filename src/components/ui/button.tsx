import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/format";

type ButtonVariant = "primary" | "secondary" | "ghost" | "ai" | "danger";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white dark:text-[#240004] hover:bg-primary-strong border-primary",
  secondary: "bg-surface text-foreground hover:bg-surface-muted border-border",
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-surface-muted border-transparent",
  ai: "bg-ai text-white dark:text-[#170040] hover:bg-ai-soft border-ai",
  danger: "bg-danger text-white dark:text-[#2b0002] hover:opacity-90 border-danger",
};

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export function ButtonLink({
  className,
  variant = "secondary",
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: ButtonVariant; children: ReactNode }) {
  return (
    <Link
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)]",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
