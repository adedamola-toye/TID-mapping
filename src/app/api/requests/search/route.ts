import { api, readJson } from "@/server/http";
import { searchRequests } from "@/server/services/requests";

/** POST so that search terms (e.g. account numbers) never appear in URLs or access logs. */
export const POST = api(async ({ req, actor }) => searchRequests(actor, await readJson(req)));
