import { api, readJson } from "@/server/http";
import * as svc from "@/server/services/requests";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/auth/rateLimit";

/** Workflow actions on a single request. Authorisation is enforced by the service/state machine. */
export const POST = api<{ id: string }>(async ({ req, actor, params }) => {
  const body = await readJson<Record<string, unknown>>(req, 16_000);
  const action = String(body.action ?? "");
  const comment = typeof body.comment === "string" ? body.comment : null;
  const id = params.id;
  switch (action) {
    case "markReady":
      return { status: (await svc.markReady(actor, id)).request.status };
    case "submit":
      return { status: (await svc.submitToVendor(actor, id, body.confirm === true)).request.status };
    case "resubmit":
      return { status: (await svc.resubmit(actor, id, comment)).request.status };
    case "start":
      return { status: (await svc.startTreatment(actor, id)).request.status };
    case "release":
      return { status: (await svc.releaseTreatment(actor, id)).request.status };
    case "treat":
      return { status: (await svc.markTreated(actor, id, body.confirm === true, comment)).request.status };
    case "exception":
      return { status: (await svc.raiseException(actor, id, { reason: body.reason, comment })).request.status };
    case "return":
      return { status: (await svc.returnRequest(actor, id, comment ?? "")).request.status };
    case "cancel":
      return { status: (await svc.cancelRequest(actor, id, String(body.reason ?? comment ?? ""))).request.status };
    case "close":
      return { status: (await svc.closeRequest(actor, id, comment)).request.status };
    case "opened":
      await svc.recordVendorOpened(actor, id);
      return { ok: true };
    case "copied": {
      const rl = rateLimit(`copy:${actor.id}`, 300, 60_000);
      if (rl.ok) await svc.recordCopy(actor, id, String(body.field ?? ""));
      return { ok: true };
    }
    case "reveal": {
      const rl = rateLimit(`reveal:${actor.id}`, 60, 60_000);
      if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many requests.");
      return { accountNumber: await svc.revealAccount(actor, id) };
    }
    default:
      throw new AppError("BAD_REQUEST", "Unknown action.");
  }
});
