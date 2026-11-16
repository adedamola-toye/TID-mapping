"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Modal, Spinner, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";

interface V {
  id: string;
  code: string;
  name: string;
  contactEmail: string | null;
  isActive: boolean;
  userCount: number;
}

export function VendorManager({ items }: { items: V[] }) {
  const router = useRouter();
  const toast = useToast();
  const [edit, setEdit] = useState<null | { id: string | null; code: string; name: string; contactEmail: string; isActive: boolean }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { code: edit.code, name: edit.name, contactEmail: edit.contactEmail || null, isActive: edit.isActive };
      if (edit.id) await api(`/api/vendors/${edit.id}`, { method: "PATCH", body });
      else await api("/api/vendors", { body });
      toast.push("ok", "Vendor saved.");
      setEdit(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card overflow-hidden">
      <div className="flex justify-end border-b border-line px-4 py-3">
        <button className="btn-primary" onClick={() => setEdit({ id: null, code: "", name: "", contactEmail: "", isActive: true })}><Plus className="h-4 w-4" aria-hidden />Add vendor</button>
      </div>
      <table className="w-full border-separate border-spacing-0">
        <thead><tr>{["Code", "Name", "Contact", "Users", "Status", ""].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
        <tbody>
          {items.map((v) => (
            <tr key={v.id}>
              <td className="table-td ident">{v.code}</td>
              <td className="table-td font-medium">{v.name}</td>
              <td className="table-td text-sm">{v.contactEmail ?? "—"}</td>
              <td className="table-td num">{v.userCount}</td>
              <td className="table-td"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", v.isActive ? "bg-ok-50 text-ok-700" : "bg-surface-sunken text-ink-subtle")}>{v.isActive ? "Active" : "Inactive"}</span></td>
              <td className="table-td text-right"><button className="btn-secondary btn-sm" onClick={() => setEdit({ id: v.id, code: v.code, name: v.name, contactEmail: v.contactEmail ?? "", isActive: v.isActive })}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit vendor" : "Add vendor"} footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}Save</button></>}>
        {edit && (
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <Field label="Code" required>{(p) => <input {...p} className="input ident uppercase" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />}</Field>
            <Field label="Name" required>{(p) => <input {...p} className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
            <Field label="Contact email">{(p) => <input {...p} type="email" className="input" value={edit.contactEmail} onChange={(e) => setEdit({ ...edit, contactEmail: e.target.value })} />}</Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />Active</label>
          </div>
        )}
      </Modal>
    </div>
  );
}
