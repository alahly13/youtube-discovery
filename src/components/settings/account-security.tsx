"use client";

import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { authFetch } from "@/lib/client/auth-fetch";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Account Security — Change Administrator Password Feature
 * ──────────────────────────────────────────────────────────────────────────
 * - Changes password directly in Supabase Auth (authoritative identity).
 * - Separate accessible show/hide eye toggle buttons for every password input.
 * - Enforces minimum length, basic strength, and confirmation match.
 * - Re-authenticates current password before submitting change.
 * - Refreshes current session cookies seamlessly.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function AccountSecurityCard() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);

  // Form fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Visibility toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // UI state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.authenticated) setUsername(data.username ?? null);
      })
      .catch(() => {});
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPassword) {
      setError("Please enter your current password.");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setError("New password must be at least 8 characters in length.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must be different from current password.");
      return;
    }

    setBusy(true);
    try {
      const res = await authFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Password change failed. Please verify your current password.");
      }

      setSuccess("Administrator password updated successfully in Supabase Auth. Your active session has been refreshed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed.");
    } finally {
      setBusy(false);
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
        {/* Administrator identity banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/30 p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
              <UserCog className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">
                Signed in as: {username ?? "…"}
              </p>
              <p className="text-[11px] text-muted">
                Authoritative authority: Supabase Auth · Sessions validated server-side.
              </p>
            </div>
          </div>
          <Button type="button" variant="secondary" className="h-8 gap-1.5 px-3 text-xs" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </Button>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {success && (
          <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
          </p>
        )}

        {/* Change Administrator Password Form */}
        <div className="max-w-xl rounded-lg border border-border/80 p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Change Administrator Password</h4>
          </div>
          <p className="mb-4 text-xs text-muted">
            Updates your password directly in Supabase Auth. No email verification or OTP is required.
          </p>

          <form onSubmit={handleChangePassword} className="space-y-3">
            {/* Field 1: Current Password */}
            <div>
              <label htmlFor="sec-current-password" className="mb-1 block text-xs font-medium text-muted">
                Current Password
              </label>
              <div className="relative">
                <input
                  id="sec-current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                  disabled={busy}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="filter-input pr-10 text-xs"
                />
                <button
                  type="button"
                  aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                  aria-pressed={showCurrentPassword}
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-foreground focus:outline-none"
                >
                  {showCurrentPassword ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* Field 2: New Password */}
            <div>
              <label htmlFor="sec-new-password" className="mb-1 block text-xs font-medium text-muted">
                New Password
              </label>
              <div className="relative">
                <input
                  id="sec-new-password"
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Enter new password (min. 8 characters)"
                  autoComplete="new-password"
                  disabled={busy}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="filter-input pr-10 text-xs"
                />
                <button
                  type="button"
                  aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                  aria-pressed={showNewPassword}
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-foreground focus:outline-none"
                >
                  {showNewPassword ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* Field 3: Confirm New Password */}
            <div>
              <label htmlFor="sec-confirm-password" className="mb-1 block text-xs font-medium text-muted">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="sec-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  disabled={busy}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="filter-input pr-10 text-xs"
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showConfirmPassword}
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-foreground focus:outline-none"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="mt-2 h-9 px-4 text-xs"
              disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {busy ? "Updating Password…" : "Update Administrator Password"}
            </Button>
          </form>
        </div>

        <p className="text-[11px] text-muted">
          <Badge tone="neutral" className="mr-1 text-[10px]">Supabase Auth</Badge>
          Password changes update directly in Supabase Auth. No email verification or OTP is required.
        </p>
      </div>
    </Card>
  );
}
