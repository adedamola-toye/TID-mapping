import { api, readJson } from "@/server/http";
import { lookupForRemap } from "@/server/services/terminals";

export const POST = api(
  async ({ req, actor }) => {
    const body = await readJson<{ identifier?: string }>(req, 2048);
    return lookupForRemap(actor, String(body.identifier ?? ""));
  },
  { permission: "request:create" },
);
