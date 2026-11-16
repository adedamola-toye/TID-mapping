"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Card, Field, PageHeader, Spinner } from "@/components/ui";
import { MerchantFields, type Anm, type MerchantValues } from "@/components/requests/MerchantFields";
import { useToast } from "@/components/toast";

interface R {
  id: string;
  reference: string;
  type: "MAPPING" | "REMAPPING";
  mode: "edit" | "amend";
  rowVersion: number;
  serialNumber: string;
  tid: string;
  iswTid: string | null;
  agentName: string;
  accountNumber: string;
  state: string;
  area: string | null;
  anmId: string;
  priority: string;
  internalComment: string | null;
}

export function EditForm({ r, anms }: { r: R; anms: Anm[] }) {
  const router = useRouter();
  const toast = useToast();
  const [m, setM] = useState<MerchantValues>({
    agentName: r.agentName,
    accountNumber: r.accountNumber,
    state: r.state,
    area: r.area ?? "",
    anmId: anms.some((a) => a.id === r.anmId) ? r.anmId : "",
    priority: r.priority,
    internalComment: r.internalComment ?? "",
  });
  const [ids, setIds] = useState({ serialNumber: r.serialNumber, tid: r.tid, iswTid: r.iswTid ?? "" });
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amend = r.mode === "amend";
  const idsEditable = !amend && r.type === "MAPPING";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setErrors({});
    try {
      await api(`/api/requests/${r.id}`, {
        method: "PATCH",
        body: {
          mode: r.mode,
          expectedVersion: r.rowVersion,
          ...m,
          area: m.area || null,
          internalComment: m.internalComment || null,
          ...(idsEditable ? { serialNumber: ids.serialNumber, tid: ids.tid, iswTid: ids.iswTid || null } : {}),
          ...(amend ? { reason } : {}),
        },
      });
      toast.push("ok", amend ? "Amendment saved. The vendor has been notified." : "Changes saved.");
      router.push(`/requests/${r.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message);
        if (e.fields) setErrors(e.fields);
      } else setErr("Save failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-4xl space-y-6" noValidate>
      <PageHeader eyebrow={r.reference} title={amend ? "Amend released request" : "Edit request"} subtitle={amend ? "This request is already with Elnexu. Amendments are recorded in the audit trail and the vendor is notified." : undefined} />
      {err && <Alert tone="bad">{err}</Alert>}
      <Card title="Terminal">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Serial number" error={errors.serialNumber} hint={idsEditable ? undefined : "Cannot change"}>
            {(p) => <input {...p} className="input ident" disabled={!idsEditable} value={ids.serialNumber} onChange={(e) => setIds({ ...ids, serialNumber: e.target.value })} />}
          </Field>
          <Field label="TID" error={errors.tid} hint={idsEditable ? undefined : "Cannot change"}>
            {(p) => <input {...p} className="input ident uppercase" disabled={!idsEditable} maxLength={8} value={ids.tid} onChange={(e) => setIds({ ...ids, tid: e.target.value.toUpperCase() })} />}
          </Field>
          <Field label="ISW TID" error={errors.iswTid}>
            {(p) => <input {...p} className="input ident uppercase" disabled={!idsEditable} maxLength={8} value={ids.iswTid} onChange={(e) => setIds({ ...ids, iswTid: e.target.value.toUpperCase() })} />}
          </Field>
        </div>
      </Card>
      <Card title="Agent / merchant">
        <MerchantFields v={m} set={(p) => setM({ ...m, ...p })} errors={errors} anms={anms} />
      </Card>
      {amend && (
        <Card title="Amendment reason">
          <Field label="Why is this change needed?" required error={errors.reason}>
            {(p) => <textarea {...p} className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </Card>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => router.back()}>Cancel</button>
        <button className="btn-primary" disabled={busy || (amend && reason.trim().length < 3)}>{busy && <Spinner />} {amend ? "Save amendment" : "Save changes"}</button>
      </div>
    </form>
  );
}
