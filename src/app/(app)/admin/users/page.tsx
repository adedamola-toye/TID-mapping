import type { Metadata } from "next";
import { requirePage } from "@/server/http";
import { listUsers, listVendors } from "@/server/services/users";
import { PageHeader } from "@/components/ui";
import { UserManager } from "./UserManager";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { actor } = await requirePage("user:manage");
  const [users, vendors] = await Promise.all([listUsers(actor), listVendors()]);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Users" subtitle="Internal Wakeel staff and vendor (Elnexu) accounts. Vendor users only ever see their vendor's treatment queue." />
      <UserManager users={JSON.parse(JSON.stringify(users))} vendors={vendors.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name }))} selfId={actor.id} />
    </>
  );
}
