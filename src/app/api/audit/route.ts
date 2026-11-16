import { api, readJson, xlsxResponse } from "@/server/http";
import { exportAudit, searchAudit } from "@/server/services/reports";
import { verifyAuditChain } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { writeAudit } from "@/server/audit";

/** Verify the tamper-evident hash chain. */
export const GET = api(
  async ({ actor }) => {
    const res = await verifyAuditChain(getDb());
    await writeAudit(getDb(), actor, { action: "AUDIT_CHAIN_VERIFIED", entityType: "audit", newValue: res });
    return res;
  },
  { permission: "audit:view" },
);

/** { op: "search", ...filters } | { op: "export", ...filters } */
export const POST = api(
  async ({ req, actor }) => {
    const body = await readJson<Record<string, unknown>>(req);
    const { op, ...filters } = body;
    if (op === "export") return xlsxResponse(await exportAudit(actor, filters), `wakeel-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
    return searchAudit(actor, filters);
  },
  { permission: "audit:view" },
);
