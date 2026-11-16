import "server-only";
import { and, eq, inArray, isNull, desc, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "./db/client";
import { notifications, users } from "./db/schema";
import { config } from "./config";
import type { Role } from "@/lib/constants";

/**
 * Notification framework.
 * In-app notifications are always written to the database. Out-of-band channels (email, SMS,
 * WhatsApp) plug in via the ChannelAdapter interface — register an adapter to enable one.
 */
export interface NotificationMessage {
  kind: string;
  title: string;
  body?: string;
  link?: string;
}

export interface ChannelAdapter {
  name: string;
  send(recipient: { userId: string; email: string }, msg: NotificationMessage): Promise<void>;
}

const adapters: ChannelAdapter[] = [];
export function registerChannel(a: ChannelAdapter) {
  adapters.push(a);
}

/** Write in-app notifications for the given users (deduplicated). */
export async function notifyUsers(db: DbOrTx, userIds: string[], msg: NotificationMessage): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return;
  await db.insert(notifications).values(
    ids.map((userId) => ({ userId, kind: msg.kind, title: msg.title.slice(0, 200), body: msg.body ?? null, link: msg.link ?? null })),
  );
  if (adapters.length) {
    const recips = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids));
    // Fire-and-forget; channel failures must not break the business transaction.
    for (const a of adapters)
      for (const r of recips)
        a.send({ userId: r.id, email: r.email }, msg).catch((e) => console.error(`[notify:${a.name}]`, e?.message));
  }
}

export async function notifyRoles(db: DbOrTx, roles: Role[], msg: NotificationMessage, excludeUserId?: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, roles), eq(users.isActive, true)));
  await notifyUsers(db, rows.map((r) => r.id).filter((id) => id !== excludeUserId), msg);
}

export async function notifyVendor(db: DbOrTx, vendorId: string, msg: NotificationMessage) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.vendorId, vendorId), eq(users.role, "VENDOR_USER"), eq(users.isActive, true)));
  await notifyUsers(db, rows.map((r) => r.id), msg);
}

export async function listNotifications(userId: string, limit = 30) {
  const db = getDb();
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { items, unread };
}

export async function markNotificationsRead(userId: string, ids: string[] | "all") {
  const db = getDb();
  const where =
    ids === "all"
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : and(eq(notifications.userId, userId), inArray(notifications.id, ids.slice(0, 200)));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}

/** Email channel used for account messages (password reset). */
export async function notifyEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const transport = config().EMAIL_TRANSPORT;
  if (transport === "console") {
    // Development only (blocked in production by config validation).
    console.info(`\n[email:console] To: ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n`);
  }
  // "none": email delivery not configured — integrate SMTP/provider here.
}
