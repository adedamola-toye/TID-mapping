"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Card, Field, KV, PageHeader, Spinner, clsx } from "@/components/ui";
import { MerchantFields, emptyMerchant, type Anm, type MerchantValues } from "@/components/requests/MerchantFields";
import { fieldErrors, mappingInputSchema } from "@/lib/validation";
import { maskAccount } from "@/lib/format";

type Step = "capture" | "review" | "done";

export function MappingWizard({ anms, canSubmitToVendor }: { anms: Anm[]; canSubmitToVendor: boolean }) {
  const [step, setStep] = useState<Step>("capture");
  const [t, setT] = useState({ serialNumber: "", tid: "", iswTid: "" });
  const [m, setM] = useState<MerchantValues>(emptyMerchant);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; reference: string; status: string } | null>(null);
  const anm = anms.find((a) => a.id === m.anmId);
  const [found, setFound] = useState<null | { tone: "info" | "warn"; text: string; link?: { href: string; label: string } }>(null);

  /** Look the serial up in the terminal master (e.g. from Elnexu's TID sheet) and pre-fill what we know. */
  async function lookupSerial() {
    const serial = t.serialNumber.trim();
    setFound(null);
    if (serial.length < 5) return;
    try {
      const r = await api<{
        terminal: { serialNumber: string; tid: string | null; iswTid: string | null; legacyAgentName: string | null; legacyStatus: string | null; stockLocation: string | null; stockState: string | null };
        current: { agentName: string } | null;
        openRequest: { id: string | null; reference: string } | null;
      }>("/api/terminals/lookup", { body: { identifier: serial } });
      if (r.terminal.serialNumber !== serial.toUpperCase().replace(/\s/g, "")) return; // matched on TID, not serial
      if (r.current) {
        setFound({ tone: "warn", text: `This terminal is already mapped to ${r.current.agentName}. To change its agent, use remapping.`, link: { href: `/requests/new/remapping?terminal=${encodeURIComponent(r.terminal.serialNumber)}`, label: "Remap this terminal" } });
        return;
      }
      if (r.openRequest) {
        setFound({ tone: "warn", text: `This terminal already has a pending request (${r.openRequest.reference}).`, link: r.openRequest.id ? { href: `/requests/${r.openRequest.id}`, label: "Open it" } : undefined });
        return;
      }
      setT((cur) => ({ ...cur, tid: cur.tid || r.terminal.tid || "", iswTid: cur.iswTid || r.terminal.iswTid || "" }));
      setM((cur) => ({ ...cur, agentName: cur.agentName || r.terminal.legacyAgentName || "", state: cur.state || r.terminal.stockState || "" }));
      const bits = [
        r.terminal.tid && `TID ${r.terminal.tid}`,
        r.terminal.iswTid && `ISW TID ${r.terminal.iswTid}`,
        r.terminal.legacyAgentName && `merchant "${r.terminal.legacyAgentName}"`,
        r.terminal.stockLocation && `location "${r.terminal.stockLocation}"`,
        r.terminal.legacyStatus && `status "${r.terminal.legacyStatus}"`,
      ].filter(Boolean);
      setFound({ tone: "info", text: `Found on the vendor TID sheet: ${bits.join(", ")}. Empty fields were pre-filled — confirm them and add the account number and ANM.` });
    } catch {
      /* not registered yet — a new terminal record will be created */
    }
  }

  const payload = () => ({
    type: "MAPPING",
    serialNumber: t.serialNumber,
    tid: t.tid,
    iswTid: t.iswTid || null,
    ...m,
    area: m.area || null,
    internalComment: m.internalComment || null,
  });

  function validate() {
    const r = mappingInputSchema.safeParse(payload());
    const errs = r.success ? {} : fieldErrors(r.error);
    setErrors(errs);
    setFormError(Object.keys(errs).length ? "Please correct the highlighted fields." : null);
    return !Object.keys(errs).length;
  }

  async function create(mode: "draft" | "ready" | "submit") {
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<{ id: string; reference: string; status: string }>("/api/requests", { body: { ...payload(), asDraft: mode === "draft" } });
      if (mode === "submit") {
        await api(`/api/requests/${r.id}/action`, { body: { action: "submit", confirm: true } });
        r.status = "SUBMITTED";
      }
      setResult(r);
      setStep("done");
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(e.message);
        if (e.fields) setErrors(e.fields);
        if (e.fields && Object.keys(e.fields).length) setStep("capture");
      } else setFormError("Could not create the request.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setT({ serialNumber: "", tid: "", iswTid: "" });
    setM({ ...emptyMerchant, state: m.state, anmId: m.anmId });
    setErrors({});
    setConfirm(false);
    setResult(null);
    setStep("capture");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Terminal mapping" title="New terminal mapping" subtitle="Capture the terminal and the agent/merchant it is being assigned to. For many terminals at once, use a batch upload." actions={<Link href="/imports" className="btn-secondary">Batch upload</Link>} />
      <ol className="mb-6 flex items-center gap-3 text-sm" aria-label="Steps">
        {(["capture", "review", "done"] as Step[]).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={clsx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", step === s ? "bg-brand-700 text-white" : i < ["capture", "review", "done"].indexOf(step) ? "bg-brand-100 text-brand-800" : "bg-surface-sunken text-ink-subtle")}>{i + 1}</span>
            <span className={step === s ? "font-medium" : "text-ink-muted"}>{["Enter details", "Review", "Done"][i]}</span>
            {i < 2 && <span className="mx-1 h-px w-8 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      {formError && <div className="mb-4"><Alert tone="bad">{formError}</Alert></div>}

      {step === "capture" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validate()) setStep("review");
          }}
          className="space-y-6"
          noValidate
        >
          <Card title="Terminal">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Terminal serial number" required error={errors.serialNumber}>
                {(p) => <input {...p} className="input ident" autoComplete="off" maxLength={40} value={t.serialNumber} onChange={(e) => setT({ ...t, serialNumber: e.target.value })} onBlur={lookupSerial} autoFocus />}
              </Field>
              <Field label="TID" required error={errors.tid} hint="8 characters, e.g. 2WKL1136">
                {(p) => <input {...p} className="input ident uppercase" autoComplete="off" maxLength={8} value={t.tid} onChange={(e) => setT({ ...t, tid: e.target.value.toUpperCase() })} />}
              </Field>
              <Field label="ISW TID" error={errors.iswTid} hint="If applicable">
                {(p) => <input {...p} className="input ident uppercase" autoComplete="off" maxLength={8} value={t.iswTid} onChange={(e) => setT({ ...t, iswTid: e.target.value.toUpperCase() })} />}
              </Field>
            </div>
            {found && (
              <div className="mt-4">
                <Alert tone={found.tone}>
                  {found.text} {found.link && <Link className="font-medium underline" href={found.link.href}>{found.link.label}</Link>}
                </Alert>
              </div>
            )}
          </Card>
          <Card title="Agent / merchant">
            <MerchantFields v={m} set={(p) => setM({ ...m, ...p })} errors={errors} anms={anms} />
          </Card>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => validate() && create("draft")}>Save as draft</button>
            <button type="submit" className="btn-primary">Continue to review</button>
          </div>
        </form>
      )}

      {step === "review" && (
        <div className="space-y-6">
          <Card title="Review mapping">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Terminal</h3>
                <dl className="space-y-3">
                  <KV label="Serial number" mono>{t.serialNumber.toUpperCase().replace(/\s/g, "")}</KV>
                  <KV label="TID" mono>{t.tid}</KV>
                  <KV label="ISW TID" mono>{t.iswTid || "—"}</KV>
                </dl>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Merchant / agent</h3>
                <dl className="space-y-3">
                  <KV label="Name">{m.agentName.toUpperCase()}</KV>
                  <KV label="Account number" mono>{maskAccount(m.accountNumber.slice(-4))}</KV>
                  <KV label="Location">{m.state}{m.area ? ` — ${m.area}` : ""}</KV>
                  <KV label="ANM">{anm?.fullName}</KV>
                </dl>
              </div>
            </div>
          </Card>
          {canSubmitToVendor ? (
            <label className="flex items-start gap-3 rounded-md border border-brand-600/30 bg-brand-50/60 p-4 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              <span>I have reviewed the information and it is ready for vendor treatment.</span>
            </label>
          ) : (
            <Alert tone="info">Your submission will be reviewed by Wakeel operations before it is released to Elnexu.</Alert>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn-secondary" onClick={() => setStep("capture")}>Back to edit</button>
            <div className="flex flex-wrap gap-2">
              {canSubmitToVendor && <button className="btn-secondary" disabled={busy} onClick={() => create("ready")}>Save for later review</button>}
              {canSubmitToVendor ? (
                <button className="btn-primary" disabled={busy || !confirm} onClick={() => create("submit")}>{busy && <Spinner />} Submit to Elnexu</button>
              ) : (
                <button className="btn-primary" disabled={busy} onClick={() => create("ready")}>{busy && <Spinner />} Submit for review</button>
              )}
            </div>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-ok-700" aria-hidden />
            <h2 className="mt-3 text-lg font-semibold">Request {result.reference} created</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {result.status === "SUBMITTED" ? "It is now in Elnexu's treatment queue." : result.status === "DRAFT" ? "Saved as a draft." : "It is ready for review and release."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href={`/requests/${result.id}`} className="btn-secondary">View request</Link>
              <button className="btn-primary" onClick={reset}>Map another terminal</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
