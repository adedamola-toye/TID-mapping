import { api, readJson, xlsxResponse } from "@/server/http";
import * as rep from "@/server/services/reports";
import { buildWorkbook } from "@/server/excel";
import { writeAudit } from "@/server/audit";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { can } from "@/server/rbac";
import { STATUS_LABELS, REQUEST_TYPE_LABELS } from "@/lib/constants";

type Sheet = Parameters<typeof buildWorkbook>[0][number];

async function run(name: string, actor: Parameters<typeof rep.dailyReport>[0], body: unknown): Promise<{ data: unknown; sheets: Sheet[] }> {
  switch (name) {
    case "daily": {
      const d = await rep.dailyReport(actor, body);
      return {
        data: d,
        sheets: [{ name: "Daily", columns: ["day", "created", "submitted", "treated", "exceptions", "outstanding"].map((k) => ({ header: k[0].toUpperCase() + k.slice(1), key: k })), rows: d.rows }],
      };
    }
    case "vendor": {
      const d = await rep.vendorPerformance(actor, body);
      const hrs = (ms: number | null) => (ms ? Math.round((ms / 3600000) * 10) / 10 : null);
      return {
        data: d,
        sheets: [
          {
            name: "Vendor",
            columns: [
              { header: "Vendor", key: "vendor" },
              { header: "Received", key: "received" },
              { header: "Treated", key: "treated" },
              { header: "Exceptions", key: "exceptions" },
              { header: "Outstanding", key: "outstanding" },
              { header: "Avg treatment (h)", key: "avg" },
              { header: "P90 treatment (h)", key: "p90" },
              { header: "Exception rate %", key: "rate" },
            ],
            rows: d.byVendor.map((v) => ({ ...v, avg: hrs(v.avgTreatMs), p90: hrs(v.p90TreatMs), rate: Math.round(v.exceptionRate * 1000) / 10 })),
          },
          { name: "By vendor user", columns: [{ header: "User", key: "user" }, { header: "Treated", key: "treated" }, { header: "Avg (h)", key: "avg" }], rows: d.byUser.map((u) => ({ ...u, avg: hrs(u.avgTreatMs) })) },
          { name: "Exception reasons", columns: [{ header: "Reason", key: "label" }, { header: "Count", key: "n" }], rows: d.exceptionReasons },
        ],
      };
    }
    case "anm": {
      const d = await rep.anmReport(actor, body);
      return {
        data: d,
        sheets: [{ name: "ANM", columns: [{ header: "Code", key: "code" }, { header: "ANM", key: "fullName", width: 28 }, { header: "Active", key: "isActive" }, { header: "Current portfolio", key: "portfolio" }, { header: "Mapped (period)", key: "mapped" }, { header: "Remapped (period)", key: "remapped" }, { header: "Outstanding", key: "outstanding" }], rows: d.rows.map((r) => ({ ...r, isActive: r.isActive ? "Yes" : "No" })) }],
      };
    }
    case "location": {
      const d = await rep.locationReport(actor, body);
      return {
        data: d,
        sheets: [
          { name: "By bank", columns: [{ header: "Bank", key: "label" }, { header: "States", key: "states" }, { header: "Terminals", key: "terminals" }, { header: "Mappings (period)", key: "mappings" }, { header: "Remappings (period)", key: "remappings" }, { header: "Outstanding", key: "outstanding" }], rows: d.banks },
          { name: "By state", columns: [{ header: "Bank", key: "regionLabel" }, { header: "State", key: "state" }, { header: "Terminals", key: "terminals" }, { header: "Mappings (period)", key: "mappings" }, { header: "Remappings (period)", key: "remappings" }, { header: "Outstanding", key: "outstanding" }], rows: d.rows }],
      };
    }
    case "outstanding": {
      const d = await rep.outstandingReport(actor);
      return {
        data: d,
        sheets: [
          {
            name: "Outstanding",
            columns: [
              { header: "Request ID", key: "reference", width: 18 },
              { header: "Type", key: "typeL" },
              { header: "Status", key: "statusL", width: 22 },
              { header: "Priority", key: "priority" },
              { header: "Serial", key: "serialNumber", width: 20 },
              { header: "TID", key: "tid" },
              { header: "Agent/Merchant", key: "agentName", width: 30 },
              { header: "State", key: "state" },
              { header: "ANM", key: "anmName", width: 22 },
              { header: "Age (hours)", key: "age" },
            ],
            rows: d.rows.map((r) => ({ ...r, typeL: REQUEST_TYPE_LABELS[r.type], statusL: STATUS_LABELS[r.status], age: Math.round(r.ageHours) })),
          },
        ],
      };
    }
    case "activity": {
      const d = await rep.activityReport(actor, body);
      return {
        data: d,
        sheets: [{ name: "Activity", columns: ["actorName", "actorRole", "created", "submitted", "treated", "exceptions", "returned", "amended", "total"].map((k) => ({ header: k, key: k, width: 16 })), rows: d.byUser }],
      };
    }
    default:
      throw new AppError("NOT_FOUND", "Unknown report.");
  }
}

export const POST = api<{ name: string }>(
  async ({ req, actor, params }) => {
    const body = await readJson<Record<string, unknown>>(req);
    const { data, sheets } = await run(params.name, actor, body);
    if (body.format === "xlsx") {
      if (!can(actor.role, "export:run")) throw new AppError("FORBIDDEN", "Not allowed to export.");
      await writeAudit(getDb(), actor, { action: "EXPORT_REPORT", entityType: "report", entityId: params.name });
      return xlsxResponse(await buildWorkbook(sheets, { title: `Wakeel ${params.name} report`, generatedBy: actor.email }), `wakeel-${params.name}-report.xlsx`);
    }
    return data;
  },
  { permission: "report:view" },
);
