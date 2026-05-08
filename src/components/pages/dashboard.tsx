import { ArrowRight, Bot, Database, Download, Gauge, Library, Search, ShieldCheck, Tv } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

const stats = [
  { label: "Searches", value: "0", icon: Search },
  { label: "Saved manifests", value: "0", icon: Database },
  { label: "Saved videos", value: "0", icon: Library },
  { label: "Quota units", value: "0", icon: Gauge },
];

export function Dashboard() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="p-6">
          <div className="max-w-3xl">
            <Badge tone="primary">Official YouTube Data API only</Badge>
            <h1 className="mt-4 text-3xl font-semibold text-foreground md:text-4xl">
              Public YouTube metadata discovery, organized as reusable manifests.
            </h1>
            <p className="mt-3 max-w-2xl text-base text-muted">
              Search provider metadata, hydrate details, filter locally, export manifest records, and run scoped AI analysis without scraping or inventing data.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/search" variant="primary">
              <Search className="h-4 w-4" />
              Open Search
            </ButtonLink>
            <ButtonLink href="/link-explorer" variant="secondary">
              <ArrowRight className="h-4 w-4" />
              Analyze Link
            </ButtonLink>
            <ButtonLink href="/ai-search" variant="ai">
              <Bot className="h-4 w-4" />
              AI Workspace
            </ButtonLink>
          </div>
        </Card>
        <Card>
          <CardHeader title="System posture" eyebrow="Runtime boundaries" />
          <div className="space-y-3 text-sm">
            <Boundary icon={<ShieldCheck className="h-4 w-4" />} label="Secrets" value="Server-only env vars" />
            <Boundary icon={<Download className="h-4 w-4" />} label="Exports" value="JSON and NDJSON manifests" />
            <Boundary icon={<Tv className="h-4 w-4" />} label="Channels" value="Uploads playlist workflow" />
            <Boundary icon={<Bot className="h-4 w-4" />} label="AI" value="Scoped metadata context" />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">{stat.label}</p>
                <Icon className="h-5 w-5 text-muted" />
              </div>
              <p className="mt-4 font-mono text-3xl font-semibold text-foreground">{stat.value}</p>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title="Recent manifests" eyebrow="Runtime store" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Title</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 text-right font-medium">Items</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Scope note</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/70">
                  <td className="py-3 font-medium">Sample manifest: YouTube metadata research</td>
                  <td className="py-3 text-muted">Search</td>
                  <td className="py-3 text-right font-mono">4</td>
                  <td className="py-3">
                    <Badge tone="warning">Draft</Badge>
                  </td>
                  <td className="py-3 text-muted">Sample until provider key is configured</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="border-ai/30">
          <CardHeader title="AI sessions" eyebrow="Grounded assistants" />
          <p className="text-sm text-muted">
            AI routes are present and validate scope, item count, evidence refs, limitations, and confirmation-only suggestions. Missing Gemini keys return an honest unavailable response.
          </p>
          <ButtonLink href="/ai-search" variant="ai" className="mt-4 w-full">
            <Bot className="h-4 w-4" />
            Open AI Search
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}

function Boundary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted p-3">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
