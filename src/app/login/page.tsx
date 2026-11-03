"use client";

import { AlertCircle, KeyRound, Loader2, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Admin login — the username input is prefilled with the CURRENT persisted
 * username (or the bootstrap default on first run) via the public
 * /api/auth/username endpoint, which exposes nothing else.
 */

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/username")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.username === "string") {
          setUsername(data.username);
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
            errorMsg = "Invalid username or password. Please verify your credentials.";
          } else if (res.status === 403) {
            errorMsg = "Access forbidden. Your account is not confirmed or lacks administrator permissions.";
          } else if (res.status === 429) {
            errorMsg = "Too many login attempts. Please wait a few moments and try again.";
          } else if (res.status === 503) {
            errorMsg = "Authentication service is temporarily unavailable. Please try again shortly.";
          } else if (res.status >= 500) {
            errorMsg = "Server configuration error occurred during authentication.";
          } else {
            errorMsg = "Sign-in failed. Please try again.";
          }
        }
        console.warn("[auth/login] Request failed:", { status: res.status, error: errorMsg });
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
      console.error("[auth/login] Error:", displayMsg);
      setError(displayMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Lock className="h-5 w-5" />
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
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60"
            />
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={loading || !username || !password}>
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
