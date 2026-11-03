import { AppShell } from "@/components/layout/app-shell";
import { LocalDataCenterWorkspace } from "@/components/local-data/local-data-center-workspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Local Data Center | YouTube Discovery",
  description: "Independent client-side browser storage terminal for deep inventory discovery, structured exploration, verifiable zero-mutation backups, and granular permanent cleanup.",
};

export default function LocalDataPage() {
  return (
    <AppShell>
      <LocalDataCenterWorkspace />
    </AppShell>
  );
}
