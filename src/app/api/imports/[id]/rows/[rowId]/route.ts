import { api, readJson } from "@/server/http";
import { correctRow, skipRow } from "@/server/services/imports";
import { AppError } from "@/server/errors";

export const PATCH = api<{ id: string; rowId: string }>(
  async ({ req, actor, params }) => {
    const body = await readJson<{ values?: Record<string, string> }>(req, 32_000);
    if (!body.values || typeof body.values !== "object") throw new AppError("BAD_REQUEST", "No values supplied.");
    return correctRow(actor, params.id, params.rowId, body.values);
  },
  { permission: "import:run" },
);

export const DELETE = api<{ id: string; rowId: string }>(async ({ actor, params }) => skipRow(actor, params.id, params.rowId), {
  permission: "import:run",
});
