"use client";

import { CheckCircle2, Loader2, LogOut, ShieldCheck, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { authFetch } from "@/lib/client/auth-fetch";

/**
 * Account Security — the single administrator account.
 * Username/password changes require the current password, persist to Blob,
 * invalidate all sessions, and force re-login. UI hiding is NOT the
 * security boundary: every action re-verifies server-side.
 */
export function AccountSecurityCard() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* Mount-only auth status */
  useEffect(() => {
    authFetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.authenticated) setUsername(data.username ?? null);
      })
      .catch(() => {});
  }, []);
  /* Mount-only auth status (setState inside promise callback) */

  const submitChange = async (kind: "username" | "password") => {
    setBusy(kind);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, string> = { currentPassword };
      if (kind === "username") {
        if (!newUsername.trim()) throw new Error("Enter a new username");
        body.newUsername = newUsername.trim();
      } else {
        if (!newPassword) throw new Error("Enter a new password");
        body.newPassword = newPassword;
        body.confirmPassword = confirmPassword;
      }
      const res = await authFetch("/api/auth/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Account update failed");
      setUsername(data.username ?? null);
      setCurrentPassword("");
      setNewUsername("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(
        kind === "username"
          ? `Username changed to “${data.username}”. All sessions were invalidated — please sign in again.`
          : "Password changed. All sessions were invalidated — please sign in again.",
      );
      setTimeout(() => {
        router.push("/login");
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account update failed");
    } finally {
      setBusy(null);
    }
  };

  const handleLogout = async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  };

  return (
    <Card>
      <CardHeader title="Account Security" eyebrow="Single administrator account" />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/30 p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
              <UserCog className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">
                Signed in as: {username ?? "…"}
              </p>
              <p className="text-[11px] text-muted">Sessions last 7 days by default, validated server-side.</p>
            </div>
          </div>
          <Button type="button" variant="secondary" className="h-8 gap-1.5 px-3 text-xs" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </Button>
        </div>

        {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        {success && (
          <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border/80 p-3.5">
            <h4 className="mb-2 text-xs font-semibold text-foreground">Change Username</h4>
            <div className="space-y-2">
              <input
                type="password"
                placeholder="Current password (required)"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="filter-input text-xs"
              />
              <input
                type="text"
                placeholder="New username"
                autoComplete="off"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="filter-input text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={busy !== null}
                onClick={() => void submitChange("username")}
              >
                {busy === "username" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Save Username
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border/80 p-3.5">
            <h4 className="mb-2 text-xs font-semibold text-foreground">Change Password</h4>
            <div className="space-y-2">
              <input
                type="password"
                placeholder="Current password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="filter-input text-xs"
              />
              <input
                type="password"
                placeholder="New password (min 12 characters)"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="filter-input text-xs"
              />
              <input
                type="password"
                placeholder="Confirm new password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="filter-input text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                className="h-8 px-3 text-xs"
                disabled={busy !== null}
                onClick={() => void submitChange("password")}
              >
                {busy === "password" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Save Password
              </Button>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          <Badge tone="neutral" className="mr-1 text-[10px]">Security</Badge>
          Credential changes persist to private Blob storage, bump the session version, and sign out every session.
        </p>
      </div>
    </Card>
  );
}
