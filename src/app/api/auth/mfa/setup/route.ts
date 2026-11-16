import { api, readJson } from "@/server/http";
import { enableMfa } from "@/server/auth/service";
import { generateTotpSecret, otpauthUri } from "@/server/auth/totp";
import { AppError } from "@/server/errors";

/** Generate a fresh TOTP secret for enrolment (not stored until verified). */
export const GET = api(async ({ actor, session }) => {
  if (session.user.mfaEnabled) throw new AppError("BAD_REQUEST", "Two-step verification is already enabled.");
  const secret = generateTotpSecret();
  return { secret, uri: otpauthUri(secret, actor.email) };
});

/** Confirm enrolment by proving possession of the secret. */
export const POST = api(async ({ req, actor }) => {
  const body = await readJson<{ secret?: string; code?: string }>(req, 2048);
  const secret = String(body.secret ?? "");
  if (!/^[A-Z2-7]{16,64}$/.test(secret)) throw new AppError("BAD_REQUEST", "Invalid setup key.");
  await enableMfa(actor, secret, String(body.code ?? "").trim());
  return { ok: true };
});
