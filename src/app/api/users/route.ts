import { api, readJson } from "@/server/http";
import { createUser, listUsers } from "@/server/services/users";

export const GET = api(async ({ req, actor }) => ({ items: await listUsers(actor, req.nextUrl.searchParams.get("q") ?? undefined) }), {
  permission: "user:manage",
});
export const POST = api(async ({ req, actor }) => createUser(actor, await readJson(req)), { permission: "user:manage" });
