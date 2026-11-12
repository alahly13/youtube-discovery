"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  deleteSharePayload,
  readSharePayload,
} from "@/lib/pwa/share-target-cache";
import {
  buildSharedLinkRecordId,
  parseSharedFields,
  sanitizeSharedText,
  sanitizeSharedTitle,
  SHARE_REVIEW_LIMITS,
  type NormalizedShare,
  type SharePayload,
  type ShareTargetDuplicateSummary,
} from "@/lib/pwa/share-target";
import { saveSharedLink } from "@/lib/pwa/share-target-save";
import { saveEntityLocally } from "@/lib/storage/indexeddb-store";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";

type ViewState =
  | "LOADING"
  | "AUTH_REQUIRED"
  | "REVIEW"
  | "SAVING"
  | "SUCCESS"
  | "ERROR"
  | "MANUAL_ENTRY";

type DestinationType = "REFERENCES" | "RESEARCH_QUEUE";

interface SaveResultState {
  recordId: string;
  sync: "SYNCED" | "PENDING";
  message: string;
  destination: DestinationType;
}

function ShareTargetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Query parameter extraction
  const shareToken = searchParams.get("share");
  const directUrl = searchParams.get("url");
  const directTitle = searchParams.get("title");
  const directText = searchParams.get("text");
  const shareErrorParam = searchParams.get("shareError");

  // Primary state
  const [viewState, setViewState] = useState<ViewState>("LOADING");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // Form fields
  const [url, setUrl] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [destination, setDestination] = useState<DestinationType>("REFERENCES");

  // Duplicate detection state
  const [duplicate, setDuplicate] =
    useState<ShareTargetDuplicateSummary | null>(null);

  // Success result
  const [saveResult, setSaveResult] = useState<SaveResultState | null>(null);

  // Copied feedback
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/status", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            const authed = data?.authenticated === true;
            setIsAuthenticated(authed);
            const resolvedOwner =
              data?.storageOwnerUuid ||
              data?.userId ||
              syncCoordinator.getOwnerId() ||
              null;
            setOwnerId(resolvedOwner);
          } else {
            setIsAuthenticated(false);
          }
        }
      } catch {
        if (!cancelled) {
          setIsAuthenticated(false);
        }
      }
    };
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  // Process incoming share payload or query parameters
  useEffect(() => {
    let cancelled = false;

    const processIncomingShare = async () => {
      if (shareErrorParam) {
        setErrorMessage(
          shareErrorParam === "storage"
            ? "Browser storage is unavailable. Please paste the link manually."
            : "The shared content could not be read. Please enter the link manually."
        );
        setViewState("MANUAL_ENTRY");
        return;
      }

      // Case 1: Service Worker handoff via random token in Cache Storage
      if (shareToken) {
        try {
          const cacheResult = await readSharePayload(shareToken);
          if (cancelled) return;

          if (!cacheResult.ok) {
            if (cacheResult.reason === "expired") {
              setErrorMessage("The shared link session has expired (over 1 hour). Please share it again or paste it below.");
            } else if (cacheResult.reason === "missing") {
              setErrorMessage("No active shared item was found for this link token. Enter your link manually.");
            } else {
              setErrorMessage("The shared link data is corrupted or invalid. Enter your link manually.");
            }
            setViewState("MANUAL_ENTRY");
            return;
          }

          const payload: SharePayload = cacheResult.payload;
          await validateAndPopulate({
            url: payload.fields.url,
            title: payload.fields.title,
            text: payload.fields.text,
          });
          return;
        } catch {
          if (!cancelled) {
            setErrorMessage("Failed to read the shared content from storage. Enter your link manually.");
            setViewState("MANUAL_ENTRY");
          }
          return;
        }
      }

      // Case 2: Direct GET query parameters (Chrome share intent fallback or manual link)
      if (directUrl || directText || directTitle) {
        await validateAndPopulate({
          url: directUrl || "",
          title: directTitle || "",
          text: directText || "",
        });
        return;
      }

      // Case 3: Empty query - open manual entry
      setViewState("MANUAL_ENTRY");
    };

    const validateAndPopulate = async (fields: {
      url: string;
      title: string;
      text: string;
    }) => {
      // 1. Initial client-side parsing
      const clientParsed = parseSharedFields(fields);
      if (!clientParsed.ok) {
        setErrorMessage(clientParsed.message);
        setViewState("MANUAL_ENTRY");
        return;
      }

      const norm: NormalizedShare = clientParsed.value;
      setUrl(norm.url);
      setTitle(norm.suggestedTitle);
      setNotes(norm.suggestedNotes);
      setWarnings(norm.warnings);

      // 2. Server-side validation and duplicate check
      try {
        const valRes = await fetch("/api/share-target/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: norm.url,
            title: norm.suggestedTitle,
            text: norm.sharedText,
          }),
        });

        if (cancelled) return;

        if (valRes.status === 401 || valRes.status === 403) {
          setViewState("AUTH_REQUIRED");
          return;
        }

        if (valRes.ok) {
          const valData = await valRes.json();
          if (valData.data) {
            setUrl(valData.data.url);
            setTitle(valData.data.suggestedTitle || norm.suggestedTitle);
            setNotes(valData.data.suggestedNotes || norm.suggestedNotes);
            if (valData.data.warnings?.length) {
              setWarnings((prev) =>
                Array.from(new Set([...prev, ...valData.data.warnings]))
              );
            }
          }
          if (valData.duplicate) {
            setDuplicate(valData.duplicate);
          }
        }
      } catch (err) {
        console.warn("[share-target] Server validation check bypassed:", err);
      }

      if (!cancelled) {
        setViewState("REVIEW");
      }
    };

    void processIncomingShare();

    return () => {
      cancelled = true;
    };
  }, [shareToken, directUrl, directTitle, directText, shareErrorParam]);

  // Derived hostname for clean preview
  const displayDomain = useMemo(() => {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  }, [url]);

  // Copy URL action
  const handleCopyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Best-effort
    }
  };

  // Cancel action
  const handleCancel = async () => {
    if (shareToken) {
      await deleteSharePayload(shareToken);
    }
    router.push("/saved-titles-links");
  };

  // Save action
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isAuthenticated === false) {
      setViewState("AUTH_REQUIRED");
      return;
    }

    const cleanTitle = sanitizeSharedTitle(title, SHARE_REVIEW_LIMITS.title);
    const cleanUrl = url.trim();
    const cleanNotes = sanitizeSharedText(notes, SHARE_REVIEW_LIMITS.notes);

    if (!cleanUrl) {
      setErrorMessage("A valid web address (URL) is required.");
      return;
    }
    if (!cleanTitle) {
      setErrorMessage("A title is required.");
      return;
    }

    setViewState("SAVING");
    setErrorMessage(null);

    const activeOwnerId =
      ownerId || syncCoordinator.getOwnerId() || "anonymous-owner";

    try {
      if (destination === "REFERENCES") {
        // Destination 1: Saved Titles & Links (Canonical REFERENCES dataset)
        const result = await saveSharedLink({
          draft: {
            url: cleanUrl,
            title: cleanTitle,
            notes: cleanNotes,
          },
          ownerId: activeOwnerId,
          duplicate: duplicate
            ? {
                title: duplicate.title || undefined,
                recordId: duplicate.recordId || undefined,
              }
            : undefined,
          deps: {
            saveEntityLocally: async (owner, dataset, id, record) => {
              return saveEntityLocally(owner, dataset, id, record);
            },
            refreshSummary: async () => {
              await syncCoordinator.refreshSummary();
            },
            saveAll: async () => {
              return syncCoordinator.saveAll();
            },
          },
        });

        if (result.status === "AUTH_REQUIRED") {
          setViewState("AUTH_REQUIRED");
          return;
        }

        if (result.status === "INVALID" || result.status === "FAILED") {
          setErrorMessage(result.message);
          setViewState("REVIEW");
          return;
        }

        if (result.status === "DUPLICATE") {
          setErrorMessage(result.message);
          setViewState("REVIEW");
          return;
        }

        if (result.status === "SAVED") {
          if (shareToken) {
            await deleteSharePayload(shareToken);
          }
          setSaveResult({
            recordId: result.recordId,
            sync: result.sync,
            message: result.message,
            destination: "REFERENCES",
          });
          setViewState("SUCCESS");
        }
      } else {
        // Destination 2: I Will Search For (RESEARCH_QUEUE dataset)
        const now = new Date().toISOString();
        const recordId = buildSharedLinkRecordId(cleanUrl);
        const queueRecord = {
          id: recordId,
          recordId,
          resourceId: cleanUrl,
          resourceType: "SAVED_LINK",
          title: cleanTitle,
          url: cleanUrl,
          notes: cleanNotes || undefined,
          priority: 2,
          status: "PENDING",
          queuedAt: now,
          createdAt: now,
          updatedAt: now,
          source: "PWA_SHARE_TARGET",
        };

        await saveEntityLocally(
          activeOwnerId,
          "RESEARCH_QUEUE",
          recordId,
          queueRecord
        );
        await syncCoordinator.refreshSummary();
        const syncOut = await syncCoordinator.saveAll();

        if (shareToken) {
          await deleteSharePayload(shareToken);
        }

        setSaveResult({
          recordId,
          sync: syncOut.ok ? "SYNCED" : "PENDING",
          message: syncOut.ok
            ? "Saved to Research Queue and synced to the cloud."
            : "Saved to Research Queue locally. Sync will retry automatically.",
          destination: "RESEARCH_QUEUE",
        });
        setViewState("SUCCESS");
      }
    } catch (err) {
      console.error("[share-target] Save error:", err);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while saving. Please try again."
      );
      setViewState("REVIEW");
    }
  };

  // Manual fallback submission
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clientParsed = parseSharedFields({ url, title, text: notes });
    if (!clientParsed.ok) {
      setErrorMessage(clientParsed.message);
      return;
    }
    const norm = clientParsed.value;
    setUrl(norm.url);
    setTitle(norm.suggestedTitle);
    setNotes(norm.suggestedNotes);
    setWarnings(norm.warnings);
    setErrorMessage(null);
    setViewState("REVIEW");
  };

  // Target path for login preservation
  const loginPreservationPath = useMemo(() => {
    if (shareToken) {
      return `/share-target?share=${encodeURIComponent(shareToken)}`;
    }
    if (url) {
      const q = new URLSearchParams();
      q.set("url", url);
      if (title) q.set("title", title);
      return `/share-target?${q.toString()}`;
    }
    return "/share-target";
  }, [shareToken, url, title]);

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-blue-500 shadow-xs">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Web Share Receiver
            </h1>
            <p className="text-xs text-muted">
              Receive and save shared links directly into your cloud library
            </p>
          </div>
        </div>
        <Link
          href="/saved-titles-links"
          className="rounded-lg p-2 text-muted hover:bg-surface-raised hover:text-foreground"
          title="Back to Saved Titles & Links"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </div>

      {/* State 1: LOADING */}
      {viewState === "LOADING" && (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <h2 className="mt-4 text-sm font-semibold text-foreground">
            Processing incoming shared link...
          </h2>
          <p className="mt-1 text-xs text-muted">
            Reading and validating shared webpage metadata safely
          </p>
        </Card>
      )}

      {/* State 2: AUTH REQUIRED */}
      {viewState === "AUTH_REQUIRED" && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-bold text-foreground">
            Sign In Required
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            You must be signed in as the administrator to save shared pages to
            your library. Your shared link data has been securely retained and
            will be waiting for you once you sign in.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              type="button"
              className="h-10 px-6 font-semibold"
              onClick={() => {
                router.push(
                  `/login?next=${encodeURIComponent(loginPreservationPath)}`
                );
              }}
            >
              Sign In to Continue
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-10"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* State 3: SAVING SPINNER */}
      {viewState === "SAVING" && (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <h2 className="mt-4 text-sm font-semibold text-foreground">
            Saving to {destination === "REFERENCES" ? "Saved Titles & Links" : "Research Queue"}...
          </h2>
          <p className="mt-1 text-xs text-muted">
            Writing to local storage and synchronizing with Cloudflare R2
          </p>
        </Card>
      )}

      {/* State 4: SUCCESS CONFIRMATION */}
      {viewState === "SUCCESS" && saveResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-foreground">
            Link Saved Successfully!
          </h2>
          <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {saveResult.message}
          </p>

          <div className="mt-4 rounded-xl border border-border/80 bg-surface p-4 text-left">
            <div className="flex items-center gap-2">
              <Badge tone="success">
                {saveResult.sync === "SYNCED" ? "Cloud Synced" : "Pending Sync"}
              </Badge>
              <Badge tone="primary">
                {saveResult.destination === "REFERENCES"
                  ? "Saved Titles & Links"
                  : "Research Queue"}
              </Badge>
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-bold text-foreground">
              {title}
            </p>
            <p className="mt-1 truncate text-xs text-muted">{url}</p>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              type="button"
              className="h-10 px-5 font-semibold"
              onClick={() => {
                router.push(
                  saveResult.destination === "REFERENCES"
                    ? "/saved-titles-links"
                    : "/dashboard/i-will-search-for"
                );
              }}
            >
              View in Library
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-10"
              onClick={() => {
                setUrl("");
                setTitle("");
                setNotes("");
                setDuplicate(null);
                setSaveResult(null);
                setViewState("MANUAL_ENTRY");
              }}
            >
              Save Another Link
            </Button>
          </div>
        </Card>
      )}

      {/* State 5: REVIEW & EDIT (The Main Android Share Receiving Page) */}
      {viewState === "REVIEW" && (
        <form onSubmit={handleSave} className="space-y-5">
          {/* Duplicate Banner */}
          {duplicate && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="flex-1 space-y-1">
                <p className="font-semibold">
                  This webpage is already in your library
                </p>
                <p className="leading-relaxed opacity-90">
                  Already saved as &ldquo;{duplicate.title}&rdquo;. You can review
                  or update the title below.
                </p>
              </div>
            </div>
          )}

          {/* Warnings Banner */}
          {warnings.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-border/70 bg-surface-raised p-3 text-xs text-muted">
              {warnings.map((warn, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span>{warn}</span>
                </div>
              ))}
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="font-medium leading-relaxed">{errorMessage}</p>
            </div>
          )}

          <Card className="space-y-4 p-5">
            {/* Domain & URL preview card */}
            <div className="rounded-xl border border-border/80 bg-surface-raised/60 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-blue-500" />
                  <span className="font-semibold text-xs uppercase tracking-wider text-blue-500">
                    {displayDomain || "Web link"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-surface hover:text-foreground"
                    title="Copy URL to clipboard"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copiedUrl ? "Copied" : "Copy"}</span>
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-surface hover:text-foreground"
                    title="Open webpage in new tab"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>Open</span>
                  </a>
                </div>
              </div>
              <p className="mt-2 break-all text-xs text-muted font-mono leading-relaxed">
                {url}
              </p>
            </div>

            {/* Editable Title */}
            <div>
              <label
                htmlFor="share-title"
                className="mb-1.5 flex items-center justify-between text-xs font-semibold text-foreground"
              >
                <span>Title</span>
                <span className="text-[10px] font-normal text-muted">
                  {title.length} / {SHARE_REVIEW_LIMITS.title}
                </span>
              </label>
              <input
                id="share-title"
                type="text"
                required
                maxLength={SHARE_REVIEW_LIMITS.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Page title"
                className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            {/* Optional Notes / Description */}
            <div>
              <label
                htmlFor="share-notes"
                className="mb-1.5 flex items-center justify-between text-xs font-semibold text-foreground"
              >
                <span>Notes or Shared Description</span>
                <span className="text-[10px] font-normal text-muted">
                  {notes.length} / {SHARE_REVIEW_LIMITS.notes}
                </span>
              </label>
              <textarea
                id="share-notes"
                rows={3}
                maxLength={SHARE_REVIEW_LIMITS.notes}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes or context about this page"
                className="w-full rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            {/* Destination Selection */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Save Destination
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDestination("REFERENCES")}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                    destination === "REFERENCES"
                      ? "border-blue-500 bg-blue-500/10 text-foreground ring-1 ring-blue-500"
                      : "border-border bg-surface hover:bg-surface-raised text-muted"
                  }`}
                >
                  <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <div>
                    <div className="text-xs font-bold text-foreground">
                      Saved Titles & Links
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      Standard library for web pages, articles, and references
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDestination("RESEARCH_QUEUE")}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                    destination === "RESEARCH_QUEUE"
                      ? "border-blue-500 bg-blue-500/10 text-foreground ring-1 ring-blue-500"
                      : "border-border bg-surface hover:bg-surface-raised text-muted"
                  }`}
                >
                  <Search className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <div>
                    <div className="text-xs font-bold text-foreground">
                      I Will Search For
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      Research queue for items you want to search or read later
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </Card>

          {/* Action buttons */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-5"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-11 gap-2 px-6 font-semibold shadow-sm"
            >
              <Save className="h-4 w-4" />
              <span>Save to Library</span>
            </Button>
          </div>
        </form>
      )}

      {/* State 6: MANUAL ENTRY FALLBACK */}
      {viewState === "MANUAL_ENTRY" && (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="font-medium leading-relaxed">{errorMessage}</p>
            </div>
          )}

          <Card className="space-y-4 p-5">
            <div>
              <label
                htmlFor="manual-url"
                className="mb-1.5 block text-xs font-semibold text-foreground"
              >
                Web Page Address (URL)
              </label>
              <div className="relative">
                <input
                  id="manual-url"
                  type="url"
                  required
                  autoFocus
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <Globe className="absolute left-3 top-3.5 h-4 w-4 text-muted" />
              </div>
            </div>

            <div>
              <label
                htmlFor="manual-title"
                className="mb-1.5 block text-xs font-semibold text-foreground"
              >
                Title (Optional &mdash; generated automatically if empty)
              </label>
              <input
                id="manual-title"
                type="text"
                placeholder="e.g. Interesting Research Article"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            <div>
              <label
                htmlFor="manual-notes"
                className="mb-1.5 block text-xs font-semibold text-foreground"
              >
                Notes (Optional)
              </label>
              <textarea
                id="manual-notes"
                rows={2}
                placeholder="Optional notes or tags"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-11 px-4"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 gap-2 px-6 font-semibold">
              <span>Continue to Review</span>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ShareTargetPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Globe}
        eyebrow="Web Share Target"
        title="Share Receiver (PWA)"
        description="Receive, validate, review, and save web links shared directly from Chrome on Android into your cloud-backed library."
      >
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          }
        >
          <ShareTargetContent />
        </Suspense>
      </WorkspacePage>
    </AppShell>
  );
}
