/**
 * Role-based access control. Permissions are defined in code (reviewed & versioned) rather than
 * editable at runtime — a deliberate control so that a misconfiguration can never grant the
 * vendor role internal permissions. Admins assign roles to users.
 */
import type { Role } from "@/lib/constants";

export const PERMISSIONS = [
  "dashboard:view",
  "request:create",            // capture mapping/remapping requests
  "request:view_all",          // see every internal request
  "request:view_own",          // see requests you created
  "request:edit",              // edit drafts/returned (own for submitter, any for admins)
  "request:submit_vendor",     // review & release to vendor
  "request:amend",             // controlled amendment after release
  "request:cancel",
  "request:close",
  "request:resolve_exception", // return / resubmit exceptions
  "account:view_full",         // reveal full account number (internal)
  "vendor:queue",              // vendor workspace
  "vendor:treat",              // start / mark treated / raise exception
  "terminal:view",
  "terminal:manage",
  "import:run",
  "export:run",
  "report:view",
  "anm:view",
  "anm:manage",
  "user:manage",
  "vendor:manage",
  "audit:view",
  "config:view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS.filter((p) => p !== "vendor:queue" && p !== "vendor:treat"),
  WAKEEL_ADMIN: [
    "dashboard:view",
    "request:create",
    "request:view_all",
    "request:view_own",
    "request:edit",
    "request:submit_vendor",
    "request:amend",
    "request:cancel",
    "request:close",
    "request:resolve_exception",
    "account:view_full",
    "terminal:view",
    "terminal:manage",
    "import:run",
    "export:run",
    "report:view",
    "anm:view",
    "audit:view",
  ],
  FIELD_SUBMITTER: ["request:create", "request:view_own", "request:edit", "anm:view", "terminal:view"],
  VENDOR_USER: ["vendor:queue", "vendor:treat"],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

export function isInternal(role: Role): boolean {
  return role !== "VENDOR_USER";
}

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  "dashboard:view": "View operational dashboard",
  "request:create": "Capture mapping / remapping requests",
  "request:view_all": "View all internal requests",
  "request:view_own": "View own submissions",
  "request:edit": "Edit draft / returned requests",
  "request:submit_vendor": "Review and release requests to vendor",
  "request:amend": "Amend released requests (controlled, audited)",
  "request:cancel": "Cancel requests",
  "request:close": "Close treated requests",
  "request:resolve_exception": "Return or resubmit vendor exceptions",
  "account:view_full": "Reveal full account numbers",
  "vendor:queue": "Access vendor treatment queue",
  "vendor:treat": "Mark treated / raise exceptions",
  "terminal:view": "View terminal master",
  "terminal:manage": "Manage terminal master data",
  "import:run": "Upload Excel batches",
  "export:run": "Export to Excel",
  "report:view": "View reports",
  "anm:view": "View ANMs",
  "anm:manage": "Manage ANM master list",
  "user:manage": "Manage users",
  "vendor:manage": "Manage vendors",
  "audit:view": "View audit logs",
  "config:view": "View system configuration",
};
