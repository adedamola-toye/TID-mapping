"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, EmptyState, Field, Modal, Spinner, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { NIGERIAN_STATES, REGIONS, REGION_LABELS, type RegionMap } from "@/lib/constants";

interface Anm {
  id: string;
  code: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  regions: string[];
  isActive: boolean;
  terminalCount: number;
}

const blank = { code: "", fullName: "", email: "", phone: "", regions: [] as string[], isActive: true };

export function AnmManager({ items, canManage, regions }: { items: Anm[]; canManage: boolean; regions: RegionMap }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<null | { id: string | null; v: typeof blank }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(
    () => items.filter((a) => (showInactive || a.isActive) && (!q || `${a.code} ${a.fullName} ${a.regions.join(" ")}`.toLowerCase().includes(q.toLowerCase()))),
    [items, q, showInactive],
  );

  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    setErrors({});
    try {
      const body = { ...edit.v, email: edit.v.email || null, phone: edit.v.phone || null };
      if (edit.id) await api(`/api/anms/${edit.id}`, { method: "PATCH", body });
      else await api("/api/anms", { body });
      toast.push("ok", edit.id ? "ANM updated." : "ANM added.");
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

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input className="input pl-9" placeholder="Search ANMs by name, code or state…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ANMs" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" className="accent-brand-700" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
        {canManage && <button className="btn-primary" onClick={() => setEdit({ id: null, v: { ...blank } })}><Plus className="h-4 w-4" aria-hidden />Add ANM</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0">
          <thead><tr>{["Code", "Name", "Coverage", "Contact", "Mapped terminals", "Status", ""].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className={clsx(!a.isActive && "text-ink-subtle")}>
                <td className="table-td ident">{a.code}</td>
                <td className="table-td"><Link href={`/anms/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.fullName}</Link></td>
                <td className="table-td text-xs">{a.regions.join(", ") || "—"}</td>
                <td className="table-td text-xs">{a.email ?? "—"}{a.phone ? <><br />{a.phone}</> : null}</td>
                <td className="table-td num">{a.terminalCount}</td>
                <td className="table-td"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", a.isActive ? "bg-ok-50 text-ok-700" : "bg-surface-sunken text-ink-subtle")}>{a.isActive ? "Active" : "Inactive"}</span></td>
                <td className="table-td text-right">
                  {canManage && <button className="btn-secondary btn-sm" onClick={() => setEdit({ id: a.id, v: { code: a.code, fullName: a.fullName, email: a.email ?? "", phone: a.phone ?? "", regions: a.regions, isActive: a.isActive } })}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <EmptyState title="No ANMs match." />}
      </div>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title={edit?.id ? "Edit ANM" : "Add ANM"}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />}Save</button></>}
      >
        {edit && (
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" required error={errors.code}>{(p) => <input {...p} className="input ident uppercase" value={edit.v.code} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, code: e.target.value } })} />}</Field>
              <Field label="Full name" required error={errors.fullName}>{(p) => <input {...p} className="input" value={edit.v.fullName} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, fullName: e.target.value } })} />}</Field>
              <Field label="Email" error={errors.email}>{(p) => <input {...p} type="email" className="input" value={edit.v.email} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, email: e.target.value } })} />}</Field>
              <Field label="Phone" error={errors.phone}>{(p) => <input {...p} className="input" value={edit.v.phone} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, phone: e.target.value } })} />}</Field>
            </div>
            <fieldset>
              <legend className="label">States covered</legend>
              <div className="space-y-3 rounded border border-line p-3">
                {[...REGIONS, null].map((rg) => {
                  const group = NIGERIAN_STATES.filter((st) => (rg ? regions[st] === rg : !regions[st]));
                  if (!group.length) return null;
                  const all = group.every((st) => edit.v.regions.includes(st));
                  return (
                    <div key={rg ?? "none"}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{rg ? REGION_LABELS[rg] : "Not assigned to a bank"}</span>
                        <button
                          type="button"
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() =>
                            setEdit({ ...edit, v: { ...edit.v, regions: all ? edit.v.regions.filter((x) => !group.includes(x as never)) : [...new Set([...edit.v.regions, ...group])] } })
                          }
                        >
                          {all ? "Clear" : `Select all ${rg ? REGION_LABELS[rg] : ""}`}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                        {group.map((st) => (
                          <label key={st} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-sunken">
                            <input type="checkbox" className="accent-brand-700" checked={edit.v.regions.includes(st)} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, regions: e.target.checked ? [...edit.v.regions, st] : edit.v.regions.filter((x) => x !== st) } })} />
                            {st}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 accent-brand-700" checked={edit.v.isActive} onChange={(e) => setEdit({ ...edit, v: { ...edit.v, isActive: e.target.checked } })} />
              <span>Active — available for new assignments. Deactivating keeps the ANM on all historical records.</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
