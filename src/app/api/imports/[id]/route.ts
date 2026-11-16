import { api, readJson, xlsxResponse } from "@/server/http";
import { cancelBatch, commitBatch, exportFailedRows, getBatch, validateBatch } from "@/server/services/imports";
import { AppError } from "@/server/errors";

export const GET = api<{ id: string }>(
  async ({ req, actor, params }) => {
    const sp = req.nextUrl.searchParams;
    if (sp.get("download") === "failed") {
      const f = await exportFailedRows(actor, params.id);
      return xlsxResponse(f.buffer, f.fileName);
    }
    return getBatch(actor, params.id, {
      status: sp.get("status") ?? undefined,
      page: Number(sp.get("page") ?? 1) || 1,
      pageSize: Number(sp.get("pageSize") ?? 50) || 50,
    });
  },
  { permission: "import:run" },
);

/** { op: "validate", mapping } | { op: "commit", asDraft } | { op: "cancel" } */
export const POST = api<{ id: string }>(
  async ({ req, actor, params }) => {
    const body = await readJson<{ op?: string; mapping?: Record<string, string | null>; asDraft?: boolean }>(req);
    switch (body.op) {
      case "validate":
        return validateBatch(actor, params.id, body.mapping ?? undefined);
      case "commit":
        return commitBatch(actor, params.id, { asDraft: body.asDraft === true });
      case "cancel":
        await cancelBatch(actor, params.id);
        return { ok: true };
      default:
        throw new AppError("BAD_REQUEST", "Unknown operation.");
    }
  },
  { permission: "import:run" },
);
