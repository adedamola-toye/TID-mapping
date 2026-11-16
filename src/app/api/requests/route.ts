import { api, readJson } from "@/server/http";
import { createMappingRequest, createRemappingRequest } from "@/server/services/requests";
import { AppError } from "@/server/errors";

/** Create a new mapping or remapping request. */
export const POST = api(
  async ({ req, actor }) => {
    const body = await readJson<Record<string, unknown>>(req);
    const asDraft = body.asDraft === true;
    const input = { ...body };
    delete input.type;
    delete input.asDraft;
    if (body.type === "MAPPING") {
      const r = await createMappingRequest(actor, input, { asDraft });
      return { id: r.id, reference: r.reference, status: r.status };
    }
    if (body.type === "REMAPPING") {
      const r = await createRemappingRequest(actor, input, { asDraft });
      return { id: r.id, reference: r.reference, status: r.status };
    }
    throw new AppError("VALIDATION", "Unknown request type.");
  },
  { permission: "request:create" },
);
