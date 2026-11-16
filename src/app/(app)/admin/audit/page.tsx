import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { can } from "@/server/rbac";
import { PageHeader } from "@/components/ui";
import { AuditViewer } from "./AuditViewer";

export const metadata: Metadata = { title: "Audit Logs" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requirePage("audit:view");
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Audit trail"
        subtitle="Every significant action: who, role, what, which record, old and new values, when and from where. The trail is append-only and hash-chained for tamper evidence."
      />
      <AuditViewer canExport={can(actor.role, "export:run")} initialEntityId={sp.entity && /^[\w-]{1,64}$/.test(sp.entity) ? sp.entity : undefined} />
    </>
  );
}
