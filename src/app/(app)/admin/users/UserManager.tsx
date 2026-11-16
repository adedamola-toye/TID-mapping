"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy, Plus, Search } from "lucide-react";
import { api, ApiError, copyText } from "@/lib/client/api";
import { Alert, Field, Modal, Spinner, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";

interface U {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  vendorName: string | null;
  vendorId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

export function UserManager({ users, vendors, selfId }: { users: U[]; vendors: { id: string; name: string }[]; selfId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("");
  const [edit, setEdit] = useState<null | { id: string | null; email: string; fullName: string; role: Role; vendorId: string; isActive: boolean }>(null);
  const [link, setLink] = useState<{ title: string; url: string; emailed: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => users.filter((u) => (!roleF || u.role === roleF) && (!q || `${u.fullName} ${u.email}`.toLowerCase().includes(q.toLowerCase()))), [users, q, roleF]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    setErrors({});
    try {
      const body = { email: edit.email, fullName: edit.fullName, role: edit.role, vendorId: edit.role === "VENDOR_USER" ? edit.vendorId || null : null, isActive: edit.isActive };
      if (edit.id) {
        await api(`/api/users/${edit.id}`, { method: "PATCH", body });
        toast.push("ok", "User updated.");
      } else {
        const r = await api<{ setPasswordLink: string; emailSent: boolean }>("/api/users", { body });
        setLink({ title: `Account created for ${edit.email}`, url: r.setPasswordLink, emailed: r.emailSent });
        toast.push(r.emailSent ? "ok" : "bad", r.emailSent ? "Setup email sent." : "Account created, but the email could not be sent.");
      }
      setEdit(null);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
        setErrors(e.fields ?? {});
      }
    } finally {
      setBusy(false);
    }
  }

  async function op(u: U, opName: "reset-password" | "unlock" | "reset-mfa") {
    try {
      const r = await api<{ link?: string; emailSent?: boolean }>(`/api/users/${u.id}`, { body: { op: opName } });
      if (r.link) setLink({ title: `Password reset issued for ${u.email}`, url: r.link, emailed: r.emailSent ?? false });
      else toast.push("ok", opName === "unlock" ? "Account unlocked." : "Two-step verification reset.");
      router.refresh();
    } catch (e) {
      toast.push("bad", e instanceof ApiError ? e.message : "Failed.");
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input className="input pl-9" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </div>
        <select className="input sm:w-48" value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <button className="btn-primary" onClick={() => { setErr(null); setErrors({}); setEdit({ id: null, email: "", fullName: "", role: "FIELD_SUBMITTER", vendorId: vendors[0]?.id ?? "", isActive: true }); }}>
          <Plus className="h-4 w-4" aria-hidden />Add user
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0">
          <thead><tr>{["Name", "Role", "Status", "Security", "Last sign-in", ""].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((u) => {
              const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
              return (
                <tr key={u.id} className={clsx(!u.isActive && "text-ink-subtle")}>
                  <td className="table-td"><div className="font-medium">{u.fullName}{u.id === selfId && <span className="ml-1 text-xs text-ink-subtle">(you)</span>}</div><div className="text-xs text-ink-muted">{u.email}</div></td>
                  <td className="table-td text-sm">{ROLE_LABELS[u.role]}{u.vendorName && <div className="text-xs text-ink-muted">{u.vendorName}</div>}</td>
                  <td className="table-td">
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", !u.isActive ? "bg-surface-sunken text-ink-subtle" : locked ? "bg-bad-50 text-bad-700" : "bg-ok-50 text-ok-700")}>{!u.isActive ? "Deactivated" : locked ? "Locked" : "Active"}</span>
                  </td>
                  <td className="table-td text-xs">{u.mfaEnabled ? "2-step on" : "Password only"}{u.mustChangePassword && <div className="text-warn-700">Password setup pending</div>}</td>
                  <td className="table-td num text-xs text-ink-muted">{fmtDateTime(u.lastLoginAt)}</td>
                  <td className="table-td whitespace-nowrap text-right">
                    {locked && <button className="btn-ghost btn-sm" onClick={() => op(u, "unlock")}>Unlock</button>}
                    {u.mfaEnabled && <button className="btn-ghost btn-sm" onClick={() => op(u, "reset-mfa")}>Reset 2-step</button>}
                    <button className="btn-ghost btn-sm" onClick={() => op(u, "reset-password")}>Reset password</button>
                    <button className="btn-secondary btn-sm" onClick={() => { setErr(null); setErrors({}); setEdit({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, vendorId: u.vendorId ?? vendors[0]?.id ?? "", isActive: u.isActive }); }}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit user" : "Add user"}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}{edit?.id ? "Save" : "Create user"}</button></>}
      >
        {edit && (
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <Field label="Full name" required error={errors.fullName}>{(p) => <input {...p} className="input" value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />}</Field>
            <Field label="Email" required error={errors.email}>{(p) => <input {...p} type="email" className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />}</Field>
            <Field label="Role" required error={errors.role} hint={edit.id === selfId ? "You cannot change your own role." : undefined}>
              {(p) => (
                <select {...p} className="input" disabled={edit.id === selfId} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              )}
            </Field>
            {edit.role === "VENDOR_USER" && (
              <Field label="Vendor" required error={errors.vendorId}>
                {(p) => <select {...p} className="input" value={edit.vendorId} onChange={(e) => setEdit({ ...edit, vendorId: e.target.value })}>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
              </Field>
            )}
            {edit.id && edit.id !== selfId && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />Account active</label>
            )}
            {!edit.id && <p className="text-xs text-ink-subtle">No password is set by the administrator. A one-time setup link (valid 30 minutes) is emailed to the user so they can choose their own password. You can also copy the link afterward as a fallback.</p>}
            {edit.id && <p className="text-xs text-ink-subtle">Changing role, vendor or status signs the user out of all sessions.</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!link} onClose={() => setLink(null)} title={link?.title ?? ""} footer={<button className="btn-primary" onClick={() => setLink(null)}>Done</button>}>
        <p className="text-sm text-ink-muted">
          {link?.emailed
            ? "An email with this one-time link has been sent to the user. It expires in 30 minutes and works once. You can also share the link below as a fallback."
            : "The email could not be sent. Share this one-time link with the user through an approved internal channel. It expires in 30 minutes and works once."}
        </p>
        <div className="mt-3 flex gap-2">
          <input readOnly className="input ident text-xs" value={link?.url ?? ""} aria-label="One-time link" onFocus={(e) => e.target.select()} />
          <button className="btn-secondary" onClick={() => link && copyText(link.url).then(() => toast.push("ok", "Link copied."))}><Copy className="h-4 w-4" aria-hidden />Copy</button>
        </div>
      </Modal>
    </div>
  );
}
