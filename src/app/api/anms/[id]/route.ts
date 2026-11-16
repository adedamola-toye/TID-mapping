import { api, readJson } from "@/server/http";
import { getAnm, updateAnm } from "@/server/services/anms";

export const GET = api<{ id: string }>(async ({ params }) => getAnm(params.id), { permission: "anm:view" });
export const PATCH = api<{ id: string }>(async ({ req, actor, params }) => updateAnm(actor, params.id, await readJson(req)), { permission: "anm:manage" });
