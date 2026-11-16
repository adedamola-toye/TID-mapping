import { describe, expect, it } from "vitest";
import { TRANSITIONS, canTransition, nextStatus, WORKFLOW_ACTIONS } from "@/server/workflow/stateMachine";
import { REQUEST_STATUSES } from "@/lib/constants";
import { ROLE_PERMISSIONS, can } from "@/server/rbac";

describe("workflow state machine", () => {
  it("follows the happy path Draft → Submitted → In Progress → Treated → Closed", () => {
    expect(nextStatus("SUBMIT_TO_VENDOR", "READY_FOR_REVIEW")).toBe("SUBMITTED");
    expect(nextStatus("START", "SUBMITTED")).toBe("IN_PROGRESS");
    expect(nextStatus("TREAT", "IN_PROGRESS")).toBe("TREATED");
    expect(nextStatus("CLOSE", "TREATED")).toBe("CLOSED");
  });
  it("routes exceptions back to internal correction", () => {
    expect(nextStatus("RAISE_EXCEPTION", "SUBMITTED")).toBe("EXCEPTION");
    expect(nextStatus("RETURN", "EXCEPTION")).toBe("RETURNED");
    expect(nextStatus("SUBMIT_TO_VENDOR", "RETURNED")).toBe("SUBMITTED");
    expect(nextStatus("RESUBMIT", "EXCEPTION")).toBe("SUBMITTED");
  });
  it("never allows treating a request that is not with the vendor", () => {
    for (const s of REQUEST_STATUSES) {
      expect(canTransition("TREAT", s)).toBe(s === "SUBMITTED" || s === "IN_PROGRESS");
    }
  });
  it("terminal states cannot transition (except closing treated)", () => {
    for (const a of WORKFLOW_ACTIONS) {
      expect(canTransition(a, "CANCELLED")).toBe(false);
      expect(canTransition(a, "CLOSED")).toBe(false);
    }
  });
  it("vendor-only actions require vendor:treat which only vendors hold", () => {
    for (const a of WORKFLOW_ACTIONS) {
      if (TRANSITIONS[a].vendor) {
        expect(TRANSITIONS[a].permission).toBe("vendor:treat");
      }
    }
    expect(can("VENDOR_USER", "vendor:treat")).toBe(true);
    expect(can("SUPER_ADMIN", "vendor:treat")).toBe(false);
    expect(can("WAKEEL_ADMIN", "vendor:treat")).toBe(false);
  });
  it("vendor role holds no internal permissions", () => {
    expect([...ROLE_PERMISSIONS.VENDOR_USER].sort()).toEqual(["vendor:queue", "vendor:treat"]);
  });
  it("field submitters cannot release to the vendor or see all records", () => {
    expect(can("FIELD_SUBMITTER", "request:submit_vendor")).toBe(false);
    expect(can("FIELD_SUBMITTER", "request:view_all")).toBe(false);
    expect(can("FIELD_SUBMITTER", "account:view_full")).toBe(false);
    expect(can("FIELD_SUBMITTER", "export:run")).toBe(false);
  });
});
