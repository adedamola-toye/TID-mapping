"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Lock, Search } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Card, Field, KV, PageHeader, Spinner, TerminalBadge } from "@/components/ui";
import type { RegionMap } from "@/lib/constants";
import { MerchantFields, emptyMerchant, type Anm, type MerchantValues } from "@/components/requests/MerchantFields";
import { fieldErrors, remappingInputSchema } from "@/lib/validation";
import { fmtDate, maskAccount } from "@/lib/format";
import type { TerminalStatus } from "@/lib/constants";

interface Lookup {
  terminal: { id: string; serialNumber: string; tid: string | null; iswTid: string | null; status: TerminalStatus };
  current: null | { version: number; agentName: string; account: string; state: string; area: string | null; anmId: string; anmName: string; effectiveFrom: string };
  openRequest: null | { id: string | null; reference: string };
  blocker: string | null;
}

export function RemapWizard({ anms, canSubmitToVendor, initialIdentifier, regions }: { anms: Anm[]; canSubmitToVendor: boolean; initialIdentifier: string; regions: RegionMap }) {
  const [ident, setIdent] = useState(initialIdentifier);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [m, setM] = useState<MerchantValues>(emptyMerchant);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState<"capture" | "review" | "done">("capture");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; reference: string; status: string } | null>(null);

  async function find(e?: React.FormEvent) {
    e?.preventDefault();
    if (!ident.trim()) return;
    setSearching(true);
    setLookupErr(null);
    setLookup(null);
    try {
      const r = await api<Lookup>("/api/terminals/lookup", { body: { identifier: ident } });
      setLookup(r);
      if (r.current) setM({ ...emptyMerchant, state: r.current.state, anmId: anms.some((a) => a.id === r.current!.anmId) ? r.current.anmId : "" });
    } catch (err) {
      setLookupErr(err instanceof ApiError ? err.message : "Lookup failed.");
    } finally {
      setSearching(false);
    }
  }
  useEffect(() => {
    if (initialIdentifier) find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payload = () => ({
    type: "REMAPPING",
    terminalId: lookup?.terminal.id,
    ...m,
    area: m.area || null,
    internalComment: m.internalComment || null,
    reason,
  });

  function validate() {
    const r = remappingInputSchema.safeParse(payload());
    const errs = r.success ? {} : fieldErrors(r.error);
    setErrors(errs);
    setFormError(Object.keys(errs).length ? "Please correct the highlighted fields." : null);
    return !Object.keys(errs).length;
  }

  async function create(mode: "ready" | "submit") {
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<{ id: string; reference: string; status: string }>("/api/requests", { body: payload() });
      if (mode === "submit") {
        await api(`/api/requests/${r.id}/action`, { body: { action: "submit", confirm: true } });
        r.status = "SUBMITTED";
      }
      setResult(r);
      setStep("done");
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(e.message);
        if (e.fields) {
          setErrors(e.fields);
          setStep("capture");
        }
      } else setFormError("Could not create the remapping.");
    } finally {
      setBusy(false);
    }
  }

  const anm = anms.find((a) => a.id === m.anmId);
  const ready = lookup && !lookup.blocker && lookup.current;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Terminal remapping"
        title="Remap a terminal"
        subtitle="Assign an already-mapped terminal to a new agent/merchant. The serial number and TID stay the same; the current mapping is preserved in the terminal's history."
      />

      {step !== "done" && (
        <Card title="1 · Find the terminal" className="mb-6">
          <form onSubmit={find} className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="ident">Serial number or TID</label>
            <input id="ident" className="input ident flex-1" placeholder="Enter terminal serial number or TID" value={ident} onChange={(e) => setIdent(e.target.value)} autoFocus disabled={step === "review"} />
            <button className="btn-primary" disabled={searching || !ident.trim() || step === "review"}>{searching ? <Spinner /> : <Search className="h-4 w-4" aria-hidden />} Find terminal</button>
          </form>
          {lookupErr && <div className="mt-4"><Alert tone="bad">{lookupErr}</Alert></div>}
          {lookup && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded border border-line bg-surface-sunken px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-ink-muted"><Lock className="h-3.5 w-3.5" aria-hidden />Locked for remapping</div>
                <KV label="Serial number" mono>{lookup.terminal.serialNumber}</KV>
                <KV label="TID" mono>{lookup.terminal.tid}</KV>
                <KV label="ISW TID" mono>{lookup.terminal.iswTid ?? "—"}</KV>
                <div><TerminalBadge status={lookup.terminal.status} /></div>
              </div>
              {lookup.blocker && (
                <Alert tone="warn" title="This terminal cannot be remapped right now">
                  {lookup.blocker}{" "}
                  {lookup.openRequest?.id && <Link className="font-medium underline" href={`/requests/${lookup.openRequest.id}`}>Open {lookup.openRequest.reference}</Link>}
                  {!lookup.current && !lookup.openRequest && <Link className="font-medium underline" href="/requests/new/mapping">Create a new mapping</Link>}
                </Alert>
              )}
            </div>
          )}
        </Card>
      )}

      {formError && <div className="mb-4"><Alert tone="bad">{formError}</Alert></div>}

      {ready && step === "capture" && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (validate()) setStep("review");
          }}
          className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]"
        >
          <Card title={`Current mapping · v${lookup.current!.version}`} className="self-start">
            <dl className="space-y-3">
              <KV label="Agent / merchant">{lookup.current!.agentName}</KV>
              <KV label="Account" mono>{lookup.current!.account}</KV>
              <KV label="Location">{lookup.current!.state}{lookup.current!.area ? ` — ${lookup.current!.area}` : ""}</KV>
              <KV label="ANM">{lookup.current!.anmName}</KV>
              <KV label="Since">{fmtDate(lookup.current!.effectiveFrom)}</KV>
            </dl>
          </Card>
          <div className="space-y-6">
            <Card title="2 · New mapping">
              <MerchantFields v={m} set={(p) => setM({ ...m, ...p })} errors={errors} anms={anms} regions={regions} />
              <div className="mt-5">
                <Field label="Reason for remapping" required error={errors.reason}>
                  {(p) => <input {...p} className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agent relocated to a new outlet" />}
                </Field>
              </div>
            </Card>
            <div className="flex justify-end"><button className="btn-primary">Continue to review</button></div>
          </div>
        </form>
      )}

      {ready && step === "review" && (
        <div className="space-y-6">
          <Card title="Review remapping">
            <div className="mb-4 flex flex-wrap gap-6 text-sm">
              <KV label="Serial number (unchanged)" mono>{lookup.terminal.serialNumber}</KV>
              <KV label="TID (unchanged)" mono>{lookup.terminal.tid}</KV>
            </div>
            <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
              <div className="rounded border border-line bg-surface-sunken p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Current</div>
                <dl className="space-y-3">
                  <KV label="Agent / merchant">{lookup.current!.agentName}</KV>
                  <KV label="Account" mono>{lookup.current!.account}</KV>
                  <KV label="Location">{lookup.current!.state}</KV>
                  <KV label="ANM">{lookup.current!.anmName}</KV>
                </dl>
              </div>
              <div className="hidden items-center md:flex"><ArrowRight className="h-5 w-5 text-ink-subtle" aria-hidden /></div>
              <div className="rounded border border-brand-600/30 bg-brand-50/60 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-800">New</div>
                <dl className="space-y-3">
                  <KV label="Agent / merchant">{m.agentName.toUpperCase()}</KV>
                  <KV label="Account" mono>{maskAccount(m.accountNumber.slice(-4))}</KV>
                  <KV label="Location">{m.state}{m.area ? ` — ${m.area}` : ""}</KV>
                  <KV label="ANM">{anm?.fullName}</KV>
                </dl>
              </div>
            </div>
            <p className="mt-4 text-sm"><span className="text-ink-muted">Reason:</span> {reason}</p>
          </Card>
          {canSubmitToVendor ? (
            <label className="flex items-start gap-3 rounded-md border border-brand-600/30 bg-brand-50/60 p-4 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              <span>I have reviewed the information and it is ready for vendor treatment.</span>
            </label>
          ) : (
            <Alert tone="info">Your remapping will be reviewed by Wakeel operations before release to Elnexu.</Alert>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn-secondary" onClick={() => setStep("capture")}>Back to edit</button>
            <div className="flex gap-2">
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
            <h2 className="mt-3 text-lg font-semibold">Remapping {result.reference} created</h2>
            <p className="mt-1 text-sm text-ink-muted">{result.status === "SUBMITTED" ? "It is now in Elnexu's treatment queue." : "It is ready for review and release."}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href={`/requests/${result.id}`} className="btn-secondary">View request</Link>
              <button className="btn-primary" onClick={() => { setStep("capture"); setLookup(null); setIdent(""); setM(emptyMerchant); setReason(""); setConfirm(false); }}>Remap another terminal</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
