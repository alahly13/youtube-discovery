import { AlertTriangle, CheckCircle2, Database, Gauge } from "lucide-react";
import type { YouTubeManifest } from "@/types/manifest";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

export function ManifestSummary({ manifest }: { manifest: YouTubeManifest }) {
  return (
    <Card>
      <CardHeader title={manifest.title} eyebrow="Temporary manifest" />
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Metric icon={<Database className="h-4 w-4" />} label="Items" value={String(manifest.uniqueItemCount)} />
        <Metric icon={<Gauge className="h-4 w-4" />} label="Quota" value={`${manifest.quotaCostEstimate} units`} />
        <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="Pages" value={String(manifest.pagesFetched)} />
        <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Duplicates" value={String(manifest.duplicateCount)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone={manifest.status === "complete" ? "success" : manifest.status === "failed" ? "danger" : "warning"}>
          {manifest.status}
        </Badge>
        <Badge>{manifest.manifestType}</Badge>
        {manifest.nextPageToken ? <Badge tone="warning">Next page available</Badge> : null}
        {manifest.warnings.map((warning) => (
          <Badge key={warning.code} tone="warning">
            {warning.message}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <div className="mb-2 flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="font-mono text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
