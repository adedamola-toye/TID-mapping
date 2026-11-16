/**
 * Shared domain constants. Safe to import from both client and server code.
 * Workflow statuses are controlled exclusively by the application — users never type them.
 */

export const ROLES = ["SUPER_ADMIN", "WAKEEL_ADMIN", "FIELD_SUBMITTER", "VENDOR_USER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  WAKEEL_ADMIN: "Wakeel Operations",
  FIELD_SUBMITTER: "Field Submitter",
  VENDOR_USER: "Vendor (Elnexu)",
};

export const REQUEST_TYPES = ["MAPPING", "REMAPPING"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  MAPPING: "New Mapping",
  REMAPPING: "Remapping",
};

export const REQUEST_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "SUBMITTED",
  "IN_PROGRESS",
  "TREATED",
  "EXCEPTION",
  "RETURNED",
  "CANCELLED",
  "CLOSED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Ready for Review",
  SUBMITTED: "Pending Vendor Treatment",
  IN_PROGRESS: "In Progress",
  TREATED: "Treated",
  EXCEPTION: "Exception",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  CLOSED: "Closed",
};

/** Statuses during which a terminal is "locked" by a request (only one open request per terminal). */
export const OPEN_STATUSES: RequestStatus[] = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "SUBMITTED",
  "IN_PROGRESS",
  "EXCEPTION",
  "RETURNED",
];

/** Statuses visible to the vendor (records that have been released to the vendor). */
export const VENDOR_VISIBLE_STATUSES: RequestStatus[] = [
  "SUBMITTED",
  "IN_PROGRESS",
  "TREATED",
  "EXCEPTION",
  "CLOSED",
];

/** Statuses in which the vendor still needs to act. */
export const VENDOR_ACTIONABLE_STATUSES: RequestStatus[] = ["SUBMITTED", "IN_PROGRESS"];

/** Internal-side statuses that can still be edited freely (before release to vendor). */
export const EDITABLE_STATUSES: RequestStatus[] = ["DRAFT", "READY_FOR_REVIEW", "RETURNED"];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EXCEPTION_REASONS = [
  "TID_UNAVAILABLE",
  "TMS_ERROR",
  "ACCOUNT_INVALID",
  "DUPLICATE_TERMINAL",
  "TERMINAL_NOT_FOUND",
  "OTHER",
] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];
export const EXCEPTION_REASON_LABELS: Record<ExceptionReason, string> = {
  TID_UNAVAILABLE: "TID unavailable",
  TMS_ERROR: "TMS error",
  ACCOUNT_INVALID: "Account information invalid",
  DUPLICATE_TERMINAL: "Duplicate terminal",
  TERMINAL_NOT_FOUND: "Terminal not found",
  OTHER: "Other",
};

export const TERMINAL_STATUSES = [
  "AVAILABLE",
  "MAPPING_PENDING",
  "MAPPED",
  "REMAPPING_PENDING",
  "INACTIVE",
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
export const TERMINAL_STATUS_LABELS: Record<TerminalStatus, string> = {
  AVAILABLE: "Available",
  MAPPING_PENDING: "Mapping Pending",
  MAPPED: "Mapped",
  REMAPPING_PENDING: "Remapping Pending",
  INACTIVE: "Inactive",
};

export const IMPORT_KINDS = ["TERMINAL_STOCK", "MAPPING", "REMAPPING"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  TERMINAL_STOCK: "Vendor terminal / TID batch",
  MAPPING: "New mapping requests",
  REMAPPING: "Remapping requests",
};

/** Nigerian states + FCT — controlled location list. */
export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
  "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
  "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
  "Yobe", "Zamfara",
] as const;
export type NigerianState = (typeof NIGERIAN_STATES)[number];

const STATE_ALIASES: Record<string, NigerianState> = {
  abuja: "FCT",
  "federal capital territory": "FCT",
  "fct abuja": "FCT",
  "abuja fct": "FCT",
  "akwa-ibom": "Akwa Ibom",
  akwaibom: "Akwa Ibom",
  "cross-river": "Cross River",
  crossriver: "Cross River",
  "port harcourt": "Rivers",
  "ph": "Rivers",
  ikeja: "Lagos",
};

/** Resolve free-text location (e.g. from a legacy spreadsheet) into a controlled state, or null. */
export function normalizeState(input: string | null | undefined): NigerianState | null {
  if (!input) return null;
  const cleaned = input.trim().toLowerCase().replace(/\s+state$/, "").replace(/\s+/g, " ");
  if (!cleaned) return null;
  const direct = NIGERIAN_STATES.find((s) => s.toLowerCase() === cleaned);
  if (direct) return direct;
  return STATE_ALIASES[cleaned] ?? null;
}
