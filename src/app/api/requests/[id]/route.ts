import { api, readJson } from "@/server/http";
import { getRequestDetail, updateRequest, amendRequest, getRequestForEdit } from "@/server/services/requests";

export const GET = api<{ id: string }>(async ({ actor, params, req }) => {
  if (req.nextUrl.searchParams.get("for") === "edit") return getRequestForEdit(actor, params.id);
  return getRequestDetail(actor, params.id);
});

/** Edit (pre-release) or amend (post-release, requires reason). */
export const PATCH = api<{ id: string }>(async ({ req, actor, params }) => {
  const body = await readJson<Record<string, unknown>>(req);
  const mode = body.mode;
  const input = { ...body };
  delete input.mode;
  const r = mode === "amend" ? await amendRequest(actor, params.id, input) : await updateRequest(actor, params.id, input);
  return { id: r.id, status: r.status, rowVersion: r.rowVersion };
});
