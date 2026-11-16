import { api, readJson } from "@/server/http";
import { saveVendor } from "@/server/services/users";

export const PATCH = api<{ id: string }>(async ({ req, actor, params }) => saveVendor(actor, params.id, await readJson(req)), {
  permission: "vendor:manage",
});
