import { api, readJson } from "@/server/http";
import { getTerminalDetail, updateTerminal } from "@/server/services/terminals";

export const GET = api<{ id: string }>(async ({ actor, params }) => getTerminalDetail(actor, params.id), { permission: "terminal:view" });

export const PATCH = api<{ id: string }>(
  async ({ req, actor, params }) => {
    const t = await updateTerminal(actor, params.id, await readJson(req));
    return { id: t.id, status: t.status };
  },
  { permission: "terminal:manage" },
);
