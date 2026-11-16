/**
 * Relational schema for the Wakeel Terminal Mapping platform (PostgreSQL / Drizzle ORM).
 *
 * Key design points:
 *  - `terminals` is the master record (current state). `terminal_mappings` keeps every mapping
 *    version — remapping never overwrites history.
 *  - `requests` holds both MAPPING and REMAPPING workflow requests (type discriminator), with a
 *    partial unique index guaranteeing at most ONE open request per terminal (concurrency guard).
 *  - Account numbers are stored encrypted (AES-256-GCM) plus an HMAC for exact-match lookups and
 *    the last 4 digits for masked display. Plaintext account numbers are never stored.
 *  - `audit_logs` is append-only (enforced by DB trigger) and hash-chained for tamper evidence.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  EXCEPTION_REASONS,
  IMPORT_KINDS,
  PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  ROLES,
  TERMINAL_STATUSES,
} from "@/lib/constants";

export const roleEnum = pgEnum("user_role", ROLES);
export const requestTypeEnum = pgEnum("request_type", REQUEST_TYPES);
export const requestStatusEnum = pgEnum("request_status", REQUEST_STATUSES);
export const priorityEnum = pgEnum("request_priority", PRIORITIES);
export const exceptionReasonEnum = pgEnum("exception_reason", EXCEPTION_REASONS);
export const terminalStatusEnum = pgEnum("terminal_status", TERMINAL_STATUSES);
export const importKindEnum = pgEnum("import_kind", IMPORT_KINDS);
export const importBatchStatusEnum = pgEnum("import_batch_status", [
  "UPLOADED",
  "VALIDATED",
  "IMPORTED",
  "CANCELLED",
]);
export const importRowStatusEnum = pgEnum("import_row_status", [
  "PENDING",
  "VALID",
  "ERROR",
  "DUPLICATE",
  "IMPORTED",
  "SKIPPED",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ───────────────────────────── Organisation & identity ───────────────────────────── */

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  contactEmail: varchar("contact_email", { length: 200 }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 200 }).notNull(),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    /** Set only for VENDOR_USER accounts — scopes every vendor query. */
    vendorId: uuid("vendor_id").references(() => vendors.id),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    /** MFA (TOTP) — extensible second factor; secret stored encrypted. */
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEnc: text("mfa_secret_enc"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_role_idx").on(t.role),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the opaque session token; the token itself only lives in the httpOnly cookie. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    csrfToken: varchar("csrf_token", { length: 64 }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** false while waiting for the MFA step. */
    mfaPassed: boolean("mfa_passed").notNull().default(true),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────────── Master data ───────────────────────────── */

export const anms = pgTable(
  "anms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    email: varchar("email", { length: 200 }),
    phone: varchar("phone", { length: 32 }),
    /** Controlled list of states this ANM covers (subset of NIGERIAN_STATES). */
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("anms_active_idx").on(t.isActive)],
);

/** Agents / merchants. Identified by account (HMAC) + normalised name. */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 150 }).notNull(),
    accountEnc: text("account_enc").notNull(),
    accountHash: varchar("account_hash", { length: 64 }).notNull(),
    accountLast4: varchar("account_last4", { length: 4 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("agents_account_name_uq").on(t.accountHash, t.name),
    index("agents_name_idx").on(t.name),
  ],
);

export const terminals = pgTable(
  "terminals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serialNumber: varchar("serial_number", { length: 40 }).notNull(),
    tid: varchar("tid", { length: 16 }),
    iswTid: varchar("isw_tid", { length: 16 }),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    status: terminalStatusEnum("status").notNull().default("AVAILABLE"),
    /** Pointer to the current (effective) mapping version. */
    currentMappingId: uuid("current_mapping_id"),
    mappedAt: timestamp("mapped_at", { withTimezone: true }),
    lastRemappedAt: timestamp("last_remapped_at", { withTimezone: true }),
    /** Identifiers/remarks preserved from vendor spreadsheets (never discarded). */
    stockLocation: varchar("stock_location", { length: 120 }),
    legacyStatus: varchar("legacy_status", { length: 60 }),
    legacyComment: text("legacy_comment"),
    extraIdentifiers: jsonb("extra_identifiers").$type<Record<string, string>>(),
    importBatchId: uuid("import_batch_id"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("terminals_serial_uq").on(t.serialNumber),
    uniqueIndex("terminals_tid_uq").on(t.tid).where(sql`${t.tid} is not null`),
    index("terminals_isw_tid_idx").on(t.iswTid),
    index("terminals_status_idx").on(t.status),
  ],
);

/** Every mapping state a terminal has ever had (version 1, 2, 3 …). */
export const terminalMappings = pgTable(
  "terminal_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    terminalId: uuid("terminal_id").notNull().references(() => terminals.id),
    version: integer("version").notNull(),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    /** Snapshots — history must remain readable even if master data changes later. */
    agentName: varchar("agent_name", { length: 150 }).notNull(),
    accountEnc: text("account_enc").notNull(),
    accountLast4: varchar("account_last4", { length: 4 }).notNull(),
    state: varchar("state", { length: 40 }).notNull(),
    area: varchar("area", { length: 120 }),
    anmId: uuid("anm_id").notNull().references(() => anms.id),
    anmName: varchar("anm_name", { length: 150 }).notNull(),
    requestId: uuid("request_id"),
    isCurrent: boolean("is_current").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("terminal_mappings_version_uq").on(t.terminalId, t.version),
    uniqueIndex("terminal_mappings_current_uq").on(t.terminalId).where(sql`${t.isCurrent}`),
    index("terminal_mappings_anm_idx").on(t.anmId),
    index("terminal_mappings_state_idx").on(t.state),
  ],
);

/* ───────────────────────────── Workflow ───────────────────────────── */

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly reference, e.g. WKL-MAP-000123 */
    reference: varchar("reference", { length: 32 }).notNull().unique(),
    type: requestTypeEnum("type").notNull(),
    status: requestStatusEnum("status").notNull().default("DRAFT"),
    priority: priorityEnum("priority").notNull().default("NORMAL"),
    terminalId: uuid("terminal_id").notNull().references(() => terminals.id),
    /** Terminal identifiers at request time (immutable for remapping). */
    serialNumber: varchar("serial_number", { length: 40 }).notNull(),
    tid: varchar("tid", { length: 16 }).notNull(),
    iswTid: varchar("isw_tid", { length: 16 }),
    /** Proposed (new) mapping. */
    agentName: varchar("agent_name", { length: 150 }).notNull(),
    accountEnc: text("account_enc").notNull(),
    accountHash: varchar("account_hash", { length: 64 }).notNull(),
    accountLast4: varchar("account_last4", { length: 4 }).notNull(),
    state: varchar("state", { length: 40 }).notNull(),
    area: varchar("area", { length: 120 }),
    anmId: uuid("anm_id").notNull().references(() => anms.id),
    anmName: varchar("anm_name", { length: 150 }).notNull(),
    /** For remapping: the mapping version being replaced. */
    previousMappingId: uuid("previous_mapping_id").references(() => terminalMappings.id),
    /** Mapping version created when the vendor treated this request. */
    resultMappingId: uuid("result_mapping_id").references(() => terminalMappings.id),
    reason: text("reason"),
    internalComment: text("internal_comment"),
    vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
    batchId: uuid("batch_id"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }),
    vendorOpenedAt: timestamp("vendor_opened_at", { withTimezone: true }),
    vendorAssigneeId: uuid("vendor_assignee_id").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    treatedBy: uuid("treated_by").references(() => users.id),
    treatedAt: timestamp("treated_at", { withTimezone: true }),
    treatmentComment: text("treatment_comment"),
    exceptionReason: exceptionReasonEnum("exception_reason"),
    exceptionComment: text("exception_comment"),
    exceptionBy: uuid("exception_by").references(() => users.id),
    exceptionAt: timestamp("exception_at", { withTimezone: true }),
    exceptionCount: integer("exception_count").notNull().default(0),
    returnedBy: uuid("returned_by").references(() => users.id),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnComment: text("return_comment"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    closedBy: uuid("closed_by").references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Optimistic concurrency token — incremented on every write. */
    rowVersion: integer("row_version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    /** Only one open request per terminal — prevents duplicate / conflicting work. */
    uniqueIndex("requests_one_open_per_terminal_uq")
      .on(t.terminalId)
      .where(
        sql`${t.status} in ('DRAFT','READY_FOR_REVIEW','SUBMITTED','IN_PROGRESS','EXCEPTION','RETURNED')`,
      ),
    index("requests_status_idx").on(t.status),
    index("requests_type_status_idx").on(t.type, t.status),
    index("requests_vendor_status_idx").on(t.vendorId, t.status),
    index("requests_created_by_idx").on(t.createdBy),
    index("requests_terminal_idx").on(t.terminalId),
    index("requests_anm_idx").on(t.anmId),
    index("requests_state_idx").on(t.state),
    index("requests_account_hash_idx").on(t.accountHash),
    index("requests_created_at_idx").on(t.createdAt),
    index("requests_submitted_at_idx").on(t.submittedAt),
    index("requests_treated_at_idx").on(t.treatedAt),
    index("requests_serial_idx").on(t.serialNumber),
    index("requests_tid_idx").on(t.tid),
    index("requests_batch_idx").on(t.batchId),
  ],
);

/** Workflow timeline (one row per transition / notable workflow action). */
export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestId: uuid("request_id").notNull().references(() => requests.id),
    action: varchar("action", { length: 40 }).notNull(),
    fromStatus: requestStatusEnum("from_status"),
    toStatus: requestStatusEnum("to_status"),
    actorId: uuid("actor_id").references(() => users.id),
    actorName: varchar("actor_name", { length: 150 }),
    actorRole: roleEnum("actor_role"),
    comment: text("comment"),
    /** Diff for amendments etc. Account numbers are masked here. */
    details: jsonb("details").$type<Record<string, unknown>>(),
    /** Whether this event is shown to the vendor (internal notes are not). */
    vendorVisible: boolean("vendor_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_events_request_idx").on(t.requestId, t.createdAt)],
);

/* ───────────────────────────── Audit & notifications ───────────────────────────── */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id"),
    actorEmail: varchar("actor_email", { length: 200 }),
    actorRole: varchar("actor_role", { length: 32 }),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: varchar("entity_id", { length: 64 }),
    entityLabel: varchar("entity_label", { length: 120 }),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    prevHash: varchar("prev_hash", { length: 64 }),
    hash: varchar("hash", { length: 64 }).notNull(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_action_idx").on(t.action),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 300 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/* ───────────────────────────── Bulk import ───────────────────────────── */

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 32 }).notNull().unique(),
    kind: importKindEnum("kind").notNull(),
    status: importBatchStatusEnum("status").notNull().default("UPLOADED"),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    sheetName: varchar("sheet_name", { length: 120 }),
    headers: jsonb("headers").$type<string[]>().notNull(),
    columnMapping: jsonb("column_mapping").$type<Record<string, string | null>>(),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    importedBy: uuid("imported_by").references(() => users.id),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("import_batches_created_idx").on(t.createdAt)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    /** Raw spreadsheet row, encrypted (may contain account numbers). */
    rawEnc: text("raw_enc").notNull(),
    /** Normalised values; account number encrypted inside (accountEnc), masked for display. */
    normalized: jsonb("normalized").$type<Record<string, unknown>>(),
    status: importRowStatusEnum("status").notNull().default("PENDING"),
    errors: jsonb("errors").$type<Record<string, string>>(),
    warnings: jsonb("warnings").$type<string[]>(),
    entityId: uuid("entity_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("import_rows_batch_row_uq").on(t.batchId, t.rowNumber),
    index("import_rows_batch_status_idx").on(t.batchId, t.status),
  ],
);

/** Sequences for human-readable references are created in migration SQL. */
