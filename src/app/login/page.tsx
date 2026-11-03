"use client";

import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Administrator Sign In UI
 * ──────────────────────────────────────────────────────────────────────────
 * - Username/Password login interface.
 * - Accessible eye button toggles password visibility without form submission.
 * - Prefills default administrator username ("asdy") via /api/auth/username.
 * - Authenticates against Next.js login route and sets Supabase SSR cookies.
 * ═══════════════════════════════════════════════════════════════════════════
 */

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("asdy");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/username")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.username === "string" && data.username.trim()) {
          setUsername(data.username.trim());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let errorMsg = data?.error;
        if (!errorMsg) {
          if (res.status === 401) {
            errorMsg = "Invalid username or password.";
          } else if (res.status === 403) {
            errorMsg = "Account requires administrative confirmation or privileges.";
          } else if (res.status === 429) {
            errorMsg = "Too many login attempts. Please wait a moment and try again.";
          } else if (res.status === 503) {
            errorMsg = "Authentication service unavailable. Please try again shortly.";
          } else {
            errorMsg = "Sign-in failed. Please verify your credentials.";
          }
        }
        throw new Error(errorMsg);
      }
      const next = searchParams.get("next");
      const destination =
        next && next.startsWith("/") && !next.startsWith("//") && next !== "/login"
          ? next
          : "/search";
      router.push(destination);
      router.refresh();
    } catch (err) {
      const displayMsg = err instanceof Error ? err.message : "Login failed";
      setError(displayMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex shrink-0 h-11 w-11 items-center justify-center rounded-xl border border-border/70 bg-surface-raised/80 p-1.5 shadow-xs overflow-hidden">
            <Image
              src="/app-icon.svg"
              alt="YouTube Discovery"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
              priority
            />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Administrator Sign In</h1>
            <p className="text-xs text-muted">YouTube Discovery · private research terminal</p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-500/50 bg-red-50 p-3 text-xs text-red-800 shadow-sm dark:border-red-500/60 dark:bg-red-950/70 dark:text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex-1 font-medium leading-relaxed">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="login-username" className="mb-1 block text-xs font-medium text-muted">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              placeholder="Enter your username"
              disabled={loading}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-xs font-medium text-muted">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface pl-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={0}
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-foreground focus:outline-none"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={loading || !username || !password}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {loading ? "Signing in…" : "Sign In"}
          </Button>
        </form>

        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          Protected area. Sessions last 7 days by default and are validated server-side on every request.
        </p>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
