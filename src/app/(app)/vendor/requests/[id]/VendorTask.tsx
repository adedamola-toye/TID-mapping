"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ClipboardCopy, Copy, Info, Play, Undo2 } from "lucide-react";
import { api, ApiError, copyText } from "@/lib/client/api";
import { Alert, Card, Modal, PriorityTag, Spinner, StatusBadge, TypeTag, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Timeline, exceptionLabel } from "@/components/requests/Timeline";
import { EXCEPTION_REASONS, EXCEPTION_REASON_LABELS } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";
import type { RequestDetail } from "@/server/services/requests";

type Detail = Omit<RequestDetail, "events"> & { events: (RequestDetail["events"][number] & { createdAt: string })[] };

function CopyRow({ label, value, field, requestId, mono = true, emphasise }: { label: string; value: string | null; field: string; requestId: string; mono?: boolean; emphasise?: boolean }) {
  const [copied, setCopied] = useState(false);
  const v = value ?? "";
  async function onCopy() {
    if (!v) return;
    if (await copyText(v)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      api(`/api/requests/${requestId}/action`, { body: { action: "copied", field } }).catch(() => {});
    }
  }
  return (
    <div className={clsx("group flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0", emphasise && "bg-accent-100/40")}>
      <div className="w-36 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted sm:w-44">{label}</div>
      <div className={clsx("min-w-0 flex-1 select-all break-all text-[15px] font-medium text-ink", mono && "ident text-[15px]")}>{v || <span className="text-ink-subtle">—</span>}</div>
      {v && (
        <button
          type="button"
          onClick={onCopy}
          className={clsx("btn-secondary btn-sm w-[5.5rem] shrink-0", copied && "border-ok-700/40 bg-ok-50 text-ok-700")}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

export function VendorTask({ detail: d }: { detail: Detail }) {
  const router = useRouter();
  const toast = useToast();
  const [modal, setModal] = useState<null | "treat" | "exception">(null);
  const [confirm, setConfirm] = useState(false);
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const actionable = d.status === "SUBMITTED" || d.status === "IN_PROGRESS";
  const remap = d.type === "REMAPPING";

  const payload = [
    `Request: ${d.reference} (${remap ? "REMAPPING" : "NEW MAPPING"})`,
    "",
    "Terminal Serial Number:",
    d.serialNumber,
    "",
    "TID:",
    d.tid,
    ...(d.iswTid ? ["", "ISW TID:", d.iswTid] : []),
    "",
    "Agent/Merchant:",
    d.agentName,
    "",
    "Account Number:",
    d.accountFull ?? d.account,
    "",
    "Location:",
    d.area ? `${d.state} — ${d.area}` : d.state,
    "",
    "ANM:",
    d.anmName,
  ].join("\n");

  async function copyAll() {
    if (await copyText(payload)) {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
      api(`/api/requests/${d.id}/action`, { body: { action: "copied", field: "copyAll" } }).catch(() => {});
    } else toast.push("bad", "Copy failed — select the text manually.");
  }

  async function act(body: Record<string, unknown>, okMsg: string, back = false) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/requests/${d.id}/action`, { body });
      toast.push("ok", okMsg);
      setModal(null);
      if (back) router.push("/vendor");
      else router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/vendor" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to queue
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TypeTag type={d.type} />
            <StatusBadge status={d.status} vendorView />
            <PriorityTag priority={d.priority} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold">{remap ? "Remap terminal" : "Map terminal"} <span className="ident text-xl text-ink-muted">{d.reference}</span></h1>
          <p className="mt-1 text-sm text-ink-muted">Released by Wakeel {fmtDateTime(d.submittedAt)}{d.assignedToMe ? " · assigned to you" : ""}</p>
        </div>
        {actionable && (
          <div className="flex flex-wrap gap-2">
            {d.permissions.start && (
              <button className="btn-secondary" disabled={busy} onClick={() => act({ action: "start" }, "Marked as in progress.")}>
                <Play className="h-4 w-4" aria-hidden /> Start treatment
              </button>
            )}
            {d.permissions.release && d.assignedToMe && (
              <button className="btn-ghost" disabled={busy} onClick={() => act({ action: "release" }, "Released back to the queue.")}>
                <Undo2 className="h-4 w-4" aria-hidden /> Release
              </button>
            )}
          </div>
        )}
      </div>

      {remap && actionable && (
        <div className="mb-5">
          <Alert tone="info" title="Remapping — the terminal serial number and TID do not change.">
            Locate the terminal in the TMS by its TID and replace the agent/merchant details with the new details below.
          </Alert>
        </div>
      )}
      {d.status === "EXCEPTION" && (
        <div className="mb-5"><Alert tone="bad" title={`Exception raised: ${exceptionLabel(d.exceptionReason)}`}>{d.exceptionComment ?? "Awaiting Wakeel review."}</Alert></div>
      )}
      {d.status === "TREATED" || d.status === "CLOSED" ? (
        <div className="mb-5"><Alert tone="ok" title={`Treated by ${d.treatedByName ?? "vendor"} on ${fmtDateTime(d.treatedAt)}`}>{d.treatmentComment ?? undefined}</Alert></div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          <Card
            title={remap ? "New mapping — enter into TMS" : "Mapping details — enter into TMS"}
            bodyClass="p-0"
            actions={
              <button onClick={copyAll} className={clsx("btn-primary", allCopied && "bg-ok-700 hover:bg-ok-700")}>
                {allCopied ? <Check className="h-4 w-4" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
                {allCopied ? "Copied" : "Copy all"}
              </button>
            }
          >
            <CopyRow requestId={d.id} field="serialNumber" label="Terminal serial" value={d.serialNumber} />
            <CopyRow requestId={d.id} field="tid" label="TID" value={d.tid} />
            {d.iswTid && <CopyRow requestId={d.id} field="iswTid" label="ISW TID" value={d.iswTid} />}
            <CopyRow requestId={d.id} field="agentName" label="Agent / merchant" value={d.agentName} mono={false} emphasise={remap} />
            <CopyRow requestId={d.id} field="accountNumber" label="Account number" value={d.accountFull ?? d.account} emphasise={remap} />
            <CopyRow requestId={d.id} field="state" label="Location" value={d.area ? `${d.state} — ${d.area}` : d.state} mono={false} emphasise={remap} />
            <CopyRow requestId={d.id} field="anm" label="ANM" value={d.anmName} mono={false} emphasise={remap} />
          </Card>

          {remap && d.previous && (
            <Card title={`Current mapping in TMS (version ${d.previous.version}) — being replaced`}>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-ink-muted">Agent / merchant</dt><dd className="mt-0.5 text-ink-muted line-through decoration-ink-subtle">{d.previous.agentName}</dd></div>
                <div><dt className="text-xs text-ink-muted">Account</dt><dd className="ident mt-0.5 text-ink-muted">{d.previous.account}</dd></div>
                <div><dt className="text-xs text-ink-muted">Location</dt><dd className="mt-0.5 text-ink-muted">{d.previous.state}{d.previous.area ? ` — ${d.previous.area}` : ""}</dd></div>
                <div><dt className="text-xs text-ink-muted">ANM</dt><dd className="mt-0.5 text-ink-muted">{d.previous.anmName}</dd></div>
              </dl>
            </Card>
          )}

          {actionable && (
            <div className="card flex flex-col gap-3 border-brand-700/20 p-5 sm:flex-row sm:items-center">
              <Info className="hidden h-5 w-5 shrink-0 text-brand-700 sm:block" aria-hidden />
              <p className="flex-1 text-sm text-ink-muted">After entering the details in the TMS, confirm the treatment here. If anything prevents you, raise an exception instead.</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary text-bad-700" onClick={() => { setErr(null); setReason(""); setComment(""); setModal("exception"); }}>
                  <AlertTriangle className="h-4 w-4" aria-hidden /> Unable to treat
                </button>
                <button className="btn-primary" onClick={() => { setErr(null); setConfirm(false); setComment(""); setModal("treat"); }}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Mark as treated
                </button>
              </div>
            </div>
          )}
        </div>

        <aside>
          <Card title="Activity">
            <Timeline events={d.events} />
          </Card>
        </aside>
      </div>

      <Modal
        open={modal === "treat"}
        onClose={() => setModal(null)}
        title="Mark as treated"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary" disabled={!confirm || busy} onClick={() => act({ action: "treat", confirm, comment: comment || null }, `${d.reference} marked as treated.`, true)}>
              {busy && <Spinner />} Confirm treated
            </button>
          </>
        }
      >
        {err && <div className="mb-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="mb-4 rounded bg-surface-sunken p-3 text-sm">
          <div className="ident">{d.serialNumber} · {d.tid}</div>
          <div className="mt-0.5 font-medium">{d.agentName}</div>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>Confirm that this terminal has been successfully {remap ? "remapped" : "mapped"} in the TMS.</span>
        </label>
        <label className="mt-4 block">
          <span className="label">Treatment comment (optional)</span>
          <textarea className="input" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </Modal>

      <Modal
        open={modal === "exception"}
        onClose={() => setModal(null)}
        title="Unable to treat — raise exception"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-danger" disabled={!reason || (reason === "OTHER" && !comment.trim()) || busy} onClick={() => act({ action: "exception", reason, comment: comment || null }, "Exception raised. Wakeel has been notified.", true)}>
              {busy && <Spinner />} Raise exception
            </button>
          </>
        }
      >
        {err && <div className="mb-3"><Alert tone="bad">{err}</Alert></div>}
        <fieldset>
          <legend className="label">Reason</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {EXCEPTION_REASONS.map((r) => (
              <label key={r} className={clsx("flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm", reason === r ? "border-bad-600 bg-bad-50" : "border-line hover:bg-surface-sunken")}>
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-bad-600" />
                {EXCEPTION_REASON_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 block">
          <span className="label">Explanation{reason === "OTHER" ? " (required)" : " (optional)"}</span>
          <textarea className="input" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
