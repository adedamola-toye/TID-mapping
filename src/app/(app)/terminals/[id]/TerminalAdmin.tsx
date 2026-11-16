"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Field, Modal, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

export function TerminalAdmin({ id, status, iswTid, legacyComment }: { id: string; status: string; iswTid: string | null; legacyComment: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ iswTid: iswTid ?? "", legacyComment: legacyComment ?? "", status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/terminals/${id}`, { method: "PATCH", body: { iswTid: v.iswTid || null, legacyComment: v.legacyComment || null, status: v.status } });
      toast.push("ok", "Terminal updated.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="btn-secondary btn-sm mt-5" onClick={() => setOpen(true)}>Manage terminal</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Manage terminal" footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />}Save</button></>}>
        {err && <div className="mb-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="space-y-4">
          <Field label="ISW TID">{(p) => <input {...p} className="input ident uppercase" maxLength={8} value={v.iswTid} onChange={(e) => setV({ ...v, iswTid: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Status">
            {(p) => (
              <select {...p} className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive (withdrawn / faulty)</option>
              </select>
            )}
          </Field>
          <Field label="Operational remark">{(p) => <textarea {...p} className="input" rows={2} maxLength={1000} value={v.legacyComment} onChange={(e) => setV({ ...v, legacyComment: e.target.value })} />}</Field>
          <p className="text-xs text-ink-subtle">Serial number and TID are permanent identifiers and cannot be edited here.</p>
        </div>
      </Modal>
    </>
  );
}
