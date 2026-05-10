"use client";

import { Bot, Loader2, ShieldCheck, ChevronDown, ChevronRight, Copy, Sparkles, X, AlertTriangle } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import type { AiAssistantRequest, AiAssistantResponse } from "@/lib/ai/youtube-ai-schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import Link from "next/link";

export function AiAssistantPanel({
  manifest,
  selectedItem,
  onSuggestedQuery,
}: {
  manifest: YouTubeManifest;
  selectedItem: NormalizedYouTubeDiscoveryItem | null;
  onSuggestedQuery?: (query: string) => void;
}) {
  const [prompt, setPrompt] = useState("Analyze the manifest and suggest hidden content patterns.");
  const [response, setResponse] = useState<AiAssistantResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    entities: true,
    patterns: true,
    queries: true,
    evidence: false,
  });

  function toggleSection(section: string) {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  const [isOpen, setIsOpen] = useState(false);
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (isOpen && !response && !loading && !hasRunRef.current) {
      hasRunRef.current = true;
      void askAssistant();
    }
  }, [isOpen, response, loading]);

  async function askAssistant() {
    setLoading(true);
    setResponse(null);

    try {
      const endpoint = selectedItem ? "/api/ai/youtube-video-explorer" : "/api/ai/youtube-manifest-assistant";
      const scope = selectedItem ? "selected_video" : getManifestAiScope(manifest.manifestType);
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          prompt,
          selectedVideoId: selectedItem?.platformItemId,
          manifestSnapshot: {
            manifestId: manifest.manifestId,
            title: manifest.title,
            manifestType: manifest.manifestType,
            normalizedItems: selectedItem ? [selectedItem] : manifest.normalizedItems,
          },
        }),
      });
      const payload = (await result.json()) as AiAssistantResponse;
      setResponse(payload);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full p-0 shadow-2xl z-50 bg-primary text-primary-foreground hover:bg-primary/90 transition-all hover:scale-105"
        onClick={() => setIsOpen(true)}
      >
        <Sparkles className="h-6 w-6 text-ai" />
        <span className="sr-only">Open AI Assistant</span>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          
          {/* Modal / Drawer */}
          <div className="relative flex flex-col w-full h-full md:h-auto md:max-h-[90vh] md:max-w-[80vw] bg-surface md:rounded-xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-surface-muted/50">
              <div className="flex flex-col">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground">
                  <Sparkles className="h-5 w-5 text-ai" /> Scoped AI Assistant
                </h2>
                <p className="text-sm text-muted">
                  {selectedItem ? `Selected video: ${selectedItem.platformItemId}` : getManifestScopeLabel(manifest.manifestType)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="ai">Grounded only</Badge>
                <Button variant="ghost" onClick={() => setIsOpen(false)} className="rounded-full h-10 w-10 p-0">
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
              
              <div className="flex flex-col gap-3">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  className="min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  placeholder="Ask the AI about this manifest..."
                />
                <Button variant="ai" onClick={askAssistant} disabled={loading} className="w-full sm:w-auto self-end">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bot className="h-4 w-4 mr-2" />}
                  Generate AI Analysis
                </Button>
              </div>

              {loading && !response && (
                <div className="flex flex-col items-center justify-center py-12 text-muted">
                  <Loader2 className="h-8 w-8 animate-spin text-ai mb-4" />
                  <p>Analyzing manifest and assembling structured report...</p>
                </div>
              )}

              {response && (
                <div className="space-y-4 text-sm animate-in fade-in duration-300">
                  <div className="flex flex-wrap gap-2">
                    {response.scope && <Badge tone="ai">Scope: {response.scope}</Badge>}
                    <Badge>Confidence: {response.confidence}</Badge>
                  </div>

                  {/* AI Parsing Error Fallback */}
                  {response.error && (
                    <div className="rounded-lg border border-danger/20 bg-danger/5 p-4 text-sm text-danger space-y-2">
                      <p className="font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> {response.error}
                      </p>
                      {response.rawExcerpt && (
                        <div className="mt-2 bg-surface p-2 rounded border border-danger/10 overflow-x-auto">
                          <pre className="text-xs font-mono text-muted">{response.rawExcerpt}</pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manifest Summary */}
                  {response.manifestSummary && Object.keys(response.manifestSummary).length > 0 && (
                    <div className="rounded-lg border border-border bg-surface-muted overflow-hidden">
                      <button onClick={() => toggleSection('summary')} className="flex w-full items-center justify-between bg-surface p-4 font-medium hover:bg-surface-muted transition-colors">
                        <span className="text-base">Manifest Overview</span>
                        {expandedSections.summary ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {expandedSections.summary && (
                        <div className="p-4 space-y-3 border-t border-border">
                          {response.manifestSummary.totalItems !== undefined && (
                            <p><span className="text-muted font-medium mr-2">Total items:</span> {response.manifestSummary.totalItems}</p>
                          )}
                          {response.manifestSummary.dateRange && (
                            <p><span className="text-muted font-medium mr-2">Date range:</span> {response.manifestSummary.dateRange}</p>
                          )}
                          {response.manifestSummary.languages && response.manifestSummary.languages.length > 0 && (
                            <p><span className="text-muted font-medium mr-2">Languages:</span> {response.manifestSummary.languages.join(", ")}</p>
                          )}
                          {response.manifestSummary.zeroMetadataItems && response.manifestSummary.zeroMetadataItems.length > 0 && (
                            <div className="mt-2">
                              <span className="text-muted font-medium">Zero-metadata items:</span>
                              <ul className="list-inside list-disc pl-1 mt-1 text-muted">
                                {response.manifestSummary.zeroMetadataItems.map((item: string, i: number) => (
                                  <li key={i}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Top Entities */}
                  {response.topEntities && Object.keys(response.topEntities).length > 0 && (
                    <div className="rounded-lg border border-border bg-surface-muted overflow-hidden">
                      <button onClick={() => toggleSection('entities')} className="flex w-full items-center justify-between bg-surface p-4 font-medium hover:bg-surface-muted transition-colors">
                        <span className="text-base">Top Channels & Topics</span>
                        {expandedSections.entities ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {expandedSections.entities && (
                        <div className="p-4 space-y-4 border-t border-border">
                          {response.topEntities.channels && response.topEntities.channels.length > 0 && (
                            <div>
                              <p className="text-muted font-medium mb-2">Channels</p>
                              <div className="flex flex-wrap gap-2">
                                {response.topEntities.channels.map((ch: string) => (
                                  <Badge key={ch} tone="neutral" className="px-2 py-1">{ch}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {response.topEntities.topics && response.topEntities.topics.length > 0 && (
                            <div>
                              <p className="text-muted font-medium mb-2">Topics</p>
                              <div className="flex flex-wrap gap-2">
                                {response.topEntities.topics.map((topic: string) => (
                                  <Badge key={topic} tone="neutral" className="px-2 py-1">{topic}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Patterns & Gaps */}
                  {response.contentPatterns && response.contentPatterns.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface-muted overflow-hidden">
                      <button onClick={() => toggleSection('patterns')} className="flex w-full items-center justify-between bg-surface p-4 font-medium hover:bg-surface-muted transition-colors">
                        <span className="text-base">Patterns & Gaps</span>
                        {expandedSections.patterns ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {expandedSections.patterns && (
                        <div className="p-4 border-t border-border">
                          <ul className="list-inside list-disc space-y-2 text-muted">
                            {response.contentPatterns.map((pattern: string, i: number) => (
                              <li key={i}>{pattern}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Suggested Queries */}
                  {response.suggestedNextQueries && response.suggestedNextQueries.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface-muted overflow-hidden">
                      <button onClick={() => toggleSection('queries')} className="flex w-full items-center justify-between bg-surface p-4 font-medium hover:bg-surface-muted transition-colors">
                        <span className="text-base">Suggested Search Queries</span>
                        {expandedSections.queries ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {expandedSections.queries && (
                        <div className="p-4 space-y-4 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-4">
                          {response.suggestedNextQueries.map((queryObj, i) => (
                            <div key={i} className="flex flex-col space-y-2 rounded-lg bg-surface p-3 border border-border/50 shadow-sm">
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-semibold text-primary">"{queryObj.query}"</span>
                                {onSuggestedQuery ? (
                                  <Button 
                                    variant="secondary" 
                                    className="shrink-0 h-8 px-3 text-xs" 
                                    onClick={() => {
                                      onSuggestedQuery(queryObj.query);
                                      setIsOpen(false);
                                    }}
                                    title="Copy to search input (requires manual confirmation to search)"
                                  >
                                    <Copy className="h-3.5 w-3.5 mr-1" /> Use
                                  </Button>
                                ) : (
                                  <Link 
                                    href={`/search?q=${encodeURIComponent(queryObj.query)}`} 
                                    className="shrink-0 inline-flex items-center text-xs font-medium text-ai hover:underline bg-ai/10 px-2 py-1 rounded" 
                                    title="Go to Search page with this query (requires manual confirmation)"
                                  >
                                    Prepare Search
                                  </Link>
                                )}
                              </div>
                              <p className="text-xs text-muted leading-relaxed">{queryObj.reasoning}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Evidence Refs */}
                  {response.evidenceRefs && response.evidenceRefs.length > 0 && (
                    <div className="rounded-lg border border-border bg-surface-muted overflow-hidden">
                      <button onClick={() => toggleSection('evidence')} className="flex w-full items-center justify-between bg-surface p-4 font-medium hover:bg-surface-muted transition-colors">
                        <span className="text-base">Evidence References</span>
                        {expandedSections.evidence ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      {expandedSections.evidence && (
                        <div className="p-4 border-t border-border">
                          <div className="flex flex-wrap gap-2">
                            {response.evidenceRefs.map((ref: string) => (
                              <Badge key={ref} tone="neutral" className="font-mono text-xs px-2 py-1">{ref}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Limitations */}
                  {response.limitations && response.limitations.length > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-danger/5 border border-danger/20 text-sm">
                      <p className="font-semibold text-danger mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Limitations
                      </p>
                      <ul className="list-inside list-disc pl-1 text-danger/80 space-y-1">
                        {response.limitations.map((lim: string, i: number) => (
                          <li key={i}>{lim}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer / Safety Disclaimer */}
            <div className="p-4 border-t border-border bg-ai-soft/10 text-sm text-muted">
              <div className="flex items-center gap-2 text-ai mb-1">
                <ShieldCheck className="h-4 w-4" />
                <span className="font-medium">Safety boundary</span>
              </div>
              <p className="text-xs leading-relaxed opacity-80">
                AI may summarize, suggest filters, and cite known manifest items. It may not invent videos, IDs, counts, private data, or playlist relationships.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function getManifestAiScope(manifestType: YouTubeManifest["manifestType"]): AiAssistantRequest["scope"] {
  if (manifestType === "youtube_channel_uploads") return "current_channel_uploads_manifest";
  if (manifestType === "youtube_playlist") return "current_playlist_manifest";
  if (manifestType === "youtube_link_explorer") return "current_link_explorer_manifest";
  return "current_search_manifest";
}

function getManifestScopeLabel(manifestType: YouTubeManifest["manifestType"]) {
  if (manifestType === "youtube_channel_uploads") return "Scoped to current channel manifest";
  if (manifestType === "youtube_playlist") return "Scoped to current playlist manifest";
  return "Scoped to current search manifest";
}
