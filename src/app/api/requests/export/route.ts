import { api, readJson, xlsxResponse } from "@/server/http";
import { exportRequests } from "@/server/services/reports";

export const POST = api(
  async ({ req, actor }) => {
    const body = await readJson<Record<string, unknown>>(req);
    const includeFullAccount = body.includeFullAccount === true;
    const filters = { ...body };
    delete filters.includeFullAccount;
    const buf = await exportRequests(actor, filters, { includeFullAccount });
    return xlsxResponse(buf, `wakeel-requests-${new Date().toISOString().slice(0, 10)}.xlsx`);
  },
  { permission: "export:run" },
);
