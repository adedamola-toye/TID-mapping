import { api, readJson } from "@/server/http";
import { searchTerminals } from "@/server/services/terminals";

export const POST = api(async ({ req, actor }) => searchTerminals(actor, await readJson(req)), { permission: "terminal:view" });
