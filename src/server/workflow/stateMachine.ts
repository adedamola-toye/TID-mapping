/**
 * Controlled workflow state machine. Pure — no I/O — so it is unit-testable and is the single
 * authority on which action is allowed from which status, and by which permission.
 *
 *   DRAFT ──mark_ready──▶ READY_FOR_REVIEW ──submit──▶ SUBMITTED ──start──▶ IN_PROGRESS
 *     │                        │                         │  ▲                 │
 *     └────────submit──────────┴─────────────────────────┘  │                 │
 *                                                       resubmit          treat / exception
 *   SUBMITTED|IN_PROGRESS ──treat──▶ TREATED ──close──▶ CLOSED
 *   SUBMITTED|IN_PROGRESS ──exception──▶ EXCEPTION ──return──▶ RETURNED ──submit──▶ SUBMITTED
 *   (most open states) ──cancel──▶ CANCELLED
 */
import type { RequestStatus } from "@/lib/constants";
import type { Permission } from "../rbac";

export const WORKFLOW_ACTIONS = [
  "UPDATE",
  "MARK_READY",
  "SUBMIT_TO_VENDOR",
  "RESUBMIT",
  "AMEND",
  "START",
  "RELEASE",
  "TREAT",
  "RAISE_EXCEPTION",
  "RETURN",
  "CANCEL",
  "CLOSE",
] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

interface TransitionRule {
  from: RequestStatus[];
  /** null = status unchanged */
  to: RequestStatus | null;
  permission: Permission;
  /** Vendor-side actions — additionally scoped to the request's vendor. */
  vendor?: boolean;
}

export const TRANSITIONS: Record<WorkflowAction, TransitionRule> = {
  UPDATE: { from: ["DRAFT", "READY_FOR_REVIEW", "RETURNED"], to: null, permission: "request:edit" },
  MARK_READY: { from: ["DRAFT", "RETURNED"], to: "READY_FOR_REVIEW", permission: "request:edit" },
  SUBMIT_TO_VENDOR: {
    from: ["DRAFT", "READY_FOR_REVIEW", "RETURNED"],
    to: "SUBMITTED",
    permission: "request:submit_vendor",
  },
  RESUBMIT: { from: ["EXCEPTION"], to: "SUBMITTED", permission: "request:resolve_exception" },
  AMEND: { from: ["SUBMITTED", "EXCEPTION"], to: null, permission: "request:amend" },
  START: { from: ["SUBMITTED"], to: "IN_PROGRESS", permission: "vendor:treat", vendor: true },
  RELEASE: { from: ["IN_PROGRESS"], to: "SUBMITTED", permission: "vendor:treat", vendor: true },
  TREAT: { from: ["SUBMITTED", "IN_PROGRESS"], to: "TREATED", permission: "vendor:treat", vendor: true },
  RAISE_EXCEPTION: { from: ["SUBMITTED", "IN_PROGRESS"], to: "EXCEPTION", permission: "vendor:treat", vendor: true },
  RETURN: { from: ["EXCEPTION", "SUBMITTED"], to: "RETURNED", permission: "request:resolve_exception" },
  CANCEL: {
    from: ["DRAFT", "READY_FOR_REVIEW", "RETURNED", "EXCEPTION", "SUBMITTED"],
    to: "CANCELLED",
    permission: "request:cancel",
  },
  CLOSE: { from: ["TREATED"], to: "CLOSED", permission: "request:close" },
};

export function canTransition(action: WorkflowAction, from: RequestStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

export function nextStatus(action: WorkflowAction, from: RequestStatus): RequestStatus {
  return TRANSITIONS[action].to ?? from;
}

const ACTION_VERBS: Record<WorkflowAction, string> = {
  UPDATE: "edited",
  MARK_READY: "marked ready for review",
  SUBMIT_TO_VENDOR: "submitted to the vendor",
  RESUBMIT: "resubmitted",
  AMEND: "amended",
  START: "started",
  RELEASE: "released",
  TREAT: "marked treated",
  RAISE_EXCEPTION: "flagged as an exception",
  RETURN: "returned",
  CANCEL: "cancelled",
  CLOSE: "closed",
};

export function transitionError(action: WorkflowAction, from: RequestStatus): string {
  return `This request cannot be ${ACTION_VERBS[action]} while it is ${from.replace(/_/g, " ").toLowerCase()}.`;
}
