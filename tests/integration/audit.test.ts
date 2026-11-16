import { describe, expect, it } from "vitest";
import { getDb, getPool } from "@/server/db/client";
import { verifyAuditChain, writeAudit } from "@/server/audit";
import { searchAudit } from "@/server/services/reports";
import { AppError } from "@/server/errors";
import { makeUser, ensureDefaultVendor } from "../fixtures";

describe("audit trail integrity", () => {
  it("is hash-chained and verifies end-to-end", async () => {
    const u = await makeUser("SUPER_ADMIN");
    await writeAudit(getDb(), u, { action: "TEST_EVENT", entityType: "test", newValue: { a: 1 } });
    const res = await verifyAuditChain(getDb());
    expect(res.ok).toBe(true);
    expect(res.checked).toBeGreaterThan(0);
  });

  it("cannot be updated, deleted or truncated (database-enforced)", async () => {
    const pool = getPool();
    await expect(pool.query("update audit_logs set action = 'TAMPERED'")).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from audit_logs")).rejects.toThrow(/append-only/);
    await expect(pool.query("truncate audit_logs")).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from workflow_events")).rejects.toThrow(/append-only/);
  });

  it("detects tampering when the trigger is bypassed", async () => {
    // Simulate a privileged attacker disabling the trigger and editing a row.
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("alter table audit_logs disable trigger audit_logs_no_update");
      await client.query("update audit_logs set action = 'TAMPERED' where id = (select min(id) from audit_logs)");
      const { rows } = await client.query("select * from audit_logs order by id");
      // Re-run verification logic on the tampered snapshot.
      const { computeAuditHash } = await import("@/server/audit");
      let prev: string | null = null;
      let broken = false;
      for (const r of rows) {
        const h = computeAuditHash(prev, {
          actorId: r.actor_id, actorEmail: r.actor_email, actorRole: r.actor_role, action: r.action,
          entityType: r.entity_type, entityId: r.entity_id, oldValue: r.old_value, newValue: r.new_value, ip: r.ip, createdAt: r.created_at,
        });
        if (h !== r.hash) {
          broken = true;
          break;
        }
        prev = r.hash;
      }
      expect(broken).toBe(true);
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect((await verifyAuditChain(getDb())).ok).toBe(true);
  });

  it("is only visible to authorised roles", async () => {
    const vendor = await makeUser("VENDOR_USER", { vendorId: (await ensureDefaultVendor()).id });
    const field = await makeUser("FIELD_SUBMITTER");
    for (const a of [vendor, field]) {
      await expect(searchAudit(a, {})).rejects.toBeInstanceOf(AppError);
    }
    const ops = await makeUser("WAKEEL_ADMIN");
    const res = await searchAudit(ops, { action: "TEST_EVENT" });
    expect(res.total).toBeGreaterThan(0);
  });
});
