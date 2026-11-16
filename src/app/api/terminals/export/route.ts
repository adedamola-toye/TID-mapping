import { api, readJson, xlsxResponse } from "@/server/http";
import { exportTerminals } from "@/server/services/reports";

export const POST = api(
  async ({ req, actor }) => xlsxResponse(await exportTerminals(actor, await readJson(req)), `wakeel-terminals-${new Date().toISOString().slice(0, 10)}.xlsx`),
  { permission: "export:run" },
);
