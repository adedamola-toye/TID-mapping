import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { requirePage } from "@/server/http";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_PERMISSIONS } from "@/server/rbac";
import { ROLES, ROLE_LABELS } from "@/lib/constants";
import { Alert, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Roles & Permissions" };

export default async function RolesPage() {
  await requirePage("user:manage");
  return (
    <>
      <PageHeader eyebrow="Administration" title="Roles & permissions" subtitle="What each role can do. Assign roles to users on the Users page." />
      <div className="mb-4">
        <Alert tone="info">
          The permission matrix is defined in version-controlled code and enforced on the server for every request. It cannot be edited at runtime — this prevents a
          misconfiguration from ever granting the vendor role access to internal data. Changes go through the bank&apos;s change-management process.
        </Alert>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="table-th">Permission</th>
              {ROLES.map((r) => <th key={r} className="table-th text-center">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p}>
                <td className="table-td"><div className="text-sm">{PERMISSION_DESCRIPTIONS[p]}</div><div className="ident text-2xs text-ink-subtle">{p}</div></td>
                {ROLES.map((r) => (
                  <td key={r} className="table-td text-center">
                    {ROLE_PERMISSIONS[r].includes(p) ? <Check className="mx-auto h-4 w-4 text-ok-700" aria-label="Allowed" /> : <Minus className="mx-auto h-4 w-4 text-line-strong" aria-label="Not allowed" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
