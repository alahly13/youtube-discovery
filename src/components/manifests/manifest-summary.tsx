import { AlertTriangle, CheckCircle2, Clock, Database, Gauge, Globe2 } from "lucide-react";
import type { YouTubeManifest } from "@/types/manifest";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

export function ManifestSummary({ manifest }: { manifest: YouTubeManifest }) {
  return (
    <Card>
      <CardHeader
        title={manifest.title}
        eyebrow={manifest.saved ? "Saved manifest" : "Temporary manifest"}
        action={<Badge tone={manifest.saved ? "success" : "warning"}>{manifest.saved ? "saved" : "temporary"}</Badge>}
      />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric icon={<Database className="h-4 w-4" />} label="Results" value={String(manifest.totalItemsCollected ?? manifest.uniqueItemCount)} />
        <Metric icon={<Gauge className="h-4 w-4" />} label="Quota" value={`${manifest.quotaCostEstimate} units`} />
        <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="Pages" value={String(manifest.pagesFetched)} />
        <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Duplicates" value={String(manifest.duplicatesCount ?? manifest.duplicateCount)} />
        <Metric icon={<Clock className="h-4 w-4" />} label="Created" value={formatDate(manifest.createdAt ?? manifest.collectedAt)} />
        <Metric icon={<Globe2 className="h-4 w-4" />} label="Region/language" value={`${manifest.region ?? "Any"} / ${manifest.language ?? "Any"}`} />
      </div>
      <div className="mt-4 rounded-lg border border-border bg-surface-muted p-3 text-sm">
        <p className="font-medium text-foreground">{manifest.query ? `Query: ${manifest.query}` : "No provider query recorded"}</p>
        <p className="mt-1 text-xs text-muted">
          Resource scope: {manifest.resourceTypes.length ? manifest.resourceTypes.join(", ") : "not provider scoped"}; page size:{" "}
          {manifest.pageSize ?? "n/a"}; fetched: {formatDate(manifest.fetchedAt ?? manifest.collectedAt)}
        </p>
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
