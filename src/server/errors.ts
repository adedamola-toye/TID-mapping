/**
 * Application errors carry a user-safe message. Technical details are logged server-side only.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "LOCKED"
  | "BAD_REQUEST";

const HTTP: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  LOCKED: 423,
  BAD_REQUEST: 400,
};

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
  get status() {
    return HTTP[this.code];
  }
}

export const forbidden = (msg = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const invalidState = (msg: string) => new AppError("INVALID_STATE", msg);
export const validation = (msg: string, fields?: Record<string, string>) =>
  new AppError("VALIDATION", msg, fields);

/** Translate PostgreSQL constraint violations into business language. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  requests_one_open_per_terminal_uq:
    "This terminal already has an open mapping/remapping request. Complete or cancel it first.",
  terminals_serial_uq: "A terminal with this serial number already exists.",
  terminals_tid_uq: "This TID is already assigned to another terminal.",
  terminal_mappings_current_uq: "This terminal already has an active mapping.",
  terminal_mappings_version_uq: "Another user updated this terminal's mapping at the same time. Please retry.",
  users_email_lower_uq: "A user with this email already exists.",
  anms_code_unique: "An ANM with this code already exists.",
  vendors_code_unique: "A vendor with this code already exists.",
};

export function fromDbError(err: unknown): AppError | null {
  const e = (err as { cause?: unknown })?.cause ?? err;
  const pg = e as { code?: string; constraint?: string };
  if (pg?.code === "23505" && pg.constraint) {
    return new AppError("CONFLICT", CONSTRAINT_MESSAGES[pg.constraint] ?? "This record conflicts with an existing record.");
  }
  if (pg?.code === "23503") return new AppError("CONFLICT", "A related record is missing or still in use.");
  if (pg?.code === "40001" || pg?.code === "40P01")
    return new AppError("CONFLICT", "Another user changed this record at the same time. Please retry.");
  if (pg?.code === "22P02") return new AppError("BAD_REQUEST", "Invalid identifier.");
  return null;
}
