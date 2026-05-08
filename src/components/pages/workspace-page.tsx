import type { LucideIcon } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function WorkspacePage({
  title,
  eyebrow,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <Badge tone="primary">{eyebrow}</Badge>
            <h1 className="mt-4 text-3xl font-semibold text-foreground">{title}</h1>
            <p className="mt-3 text-muted">{description}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </Card>
      {children ?? (
        <Card>
          <CardHeader title="Implementation surface" eyebrow="Scaffolded route" />
          <p className="text-sm text-muted">
            This page is wired into the production shell and ready for durable data once provider keys and database migrations are applied.
          </p>
        </Card>
      )}
    </div>
  );
}
