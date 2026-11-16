/**
 * Production bootstrap: create the first Super Admin (and the Elnexu vendor record if missing).
 * Prints a one-time password-set link (valid 30 minutes) — no password is ever passed on the
 * command line or stored in shell history.
 *
 *   ADMIN_EMAIL=it.admin@bank.example ADMIN_NAME="Jane Doe" npm run create-admin
 */
import "dotenv/config";
import { sql } from "drizzle-orm";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_NAME environment variables.");
  }
  const { getDb, closeDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { hashPassword } = await import("../src/server/auth/password");
  const { createResetToken } = await import("../src/server/auth/service");
  const { randomToken } = await import("../src/server/crypto");
  const { writeAudit } = await import("../src/server/audit");
  const { config } = await import("../src/server/config");
  const db = getDb();
  const [v] = await db.select().from(schema.vendors).where(sql`code = 'ELNEXU'`);
  if (!v) {
    const [nv] = await db.insert(schema.vendors).values({ code: "ELNEXU", name: "Elnexu" }).returning();
    await writeAudit(db, { id: null, email: "system/bootstrap", role: "SYSTEM" }, { action: "VENDOR_CREATED", entityType: "vendor", entityId: nv.id, entityLabel: "Elnexu" });
  }
  const [u] = await db
    .insert(schema.users)
    .values({ email, fullName: name, role: "SUPER_ADMIN", passwordHash: await hashPassword(randomToken(32)), mustChangePassword: true })
    .returning();
  await writeAudit(db, { id: null, email: "system/bootstrap", role: "SYSTEM" }, { action: "USER_CREATED", entityType: "user", entityId: u.id, entityLabel: email, newValue: { role: "SUPER_ADMIN" } });
  const token = await createResetToken(u.id, null);
  const link = `${config().APP_URL}/reset-password#token=${token}`;
  const { notifyEmail } = await import("../src/server/notifications");
  const emailSent = await notifyEmail({
    to: email,
    subject: "Your Wakeel Terminal Mapping admin account is ready",
    text: `A Super Admin account has been created for you on the Wakeel POS Terminal Mapping platform.\n\nSet your password within 30 minutes using this link:\n${link}\n\nIf you were not expecting this, please contact the platform administrator.`,
  });
  console.log(
    emailSent
      ? `Super Admin created. Setup link emailed to ${email}. It also expires in 30 minutes:\n${link}`
      : `Super Admin created, but the email could not be sent. Share this link (valid 30 minutes):\n${link}`,
  );
  await closeDb();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
