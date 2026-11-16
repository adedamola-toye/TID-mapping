"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Pencil, Send } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Card, KV, Modal, PriorityTag, Spinner, StatusBadge, TypeTag, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Timeline, exceptionLabel } from "@/components/requests/Timeline";
import { fmtDateTime } from "@/lib/format";
import type { RequestDetail } from "@/server/services/requests";

type Detail = Omit<RequestDetail, "events"> & { events: (RequestDetail["events"][number] & { createdAt: string })[] };
type ModalKind = null | "submit" | "resubmit" | "return" | "cancel" | "close";

const STEPS = ["Created", "Reviewed", "Submitted", "Vendor opened", "Treated", "Closed"];

function progressIndex(d: Detail): number {
  if (d.status === "CLOSED") return 5;
  if (d.status === "TREATED") return 4;
  if (d.vendorOpenedAt && ["SUBMITTED", "IN_PROGRESS", "EXCEPTION"].includes(d.status)) return 3;
  if (["SUBMITTED", "IN_PROGRESS", "EXCEPTION"].includes(d.status)) return 2;
  if (d.status === "READY_FOR_REVIEW") return 1;
  return 0;
}

export function RequestView({ detail: d }: { detail: Detail }) {
  const router = useRouter();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [confirm, setConfirm] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const p = d.permissions;
  const step = progressIndex(d);

  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/requests/${d.id}/action`, { body });
      toast.push("ok", msg);
      setModal(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function reveal() {
    if (account) return setAccount(null);
    try {
      const r = await api<{ accountNumber: string }>(`/api/requests/${d.id}/action`, { body: { action: "reveal" } });
      setAccount(r.accountNumber);
      setTimeout(() => setAccount(null), 30_000);
    } catch (e) {
      toast.push("bad", e instanceof ApiError ? e.message : "Not allowed.");
    }
  }
  const open = (m: ModalKind) => {
    setErr(null);
    setConfirm(false);
    setComment("");
    setModal(m);
  };

  return (
    <div>
      <button onClick={() => router.back()} className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TypeTag type={d.type} />
            <StatusBadge status={d.status} />
            <PriorityTag priority={d.priority} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold"><span className="ident text-2xl">{d.reference}</span></h1>
          <p className="mt-1 text-sm text-ink-muted">
            {d.type === "MAPPING" ? "New terminal mapping" : "Terminal remapping"} · created by {d.createdByName} on {fmtDateTime(d.createdAt)} · vendor {d.vendorName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.edit && <Link href={`/requests/${d.id}/edit`} className="btn-secondary"><Pencil className="h-4 w-4" aria-hidden />Edit</Link>}
          {p.amend && <Link href={`/requests/${d.id}/edit`} className="btn-secondary"><Pencil className="h-4 w-4" aria-hidden />Amend</Link>}
          {p.markReady && d.status !== "READY_FOR_REVIEW" && <button className="btn-secondary" disabled={busy} onClick={() => act({ action: "markReady" }, "Marked ready for review.")}>Mark ready for review</button>}
          {p.cancel && <button className="btn-ghost text-bad-700" onClick={() => open("cancel")}>Cancel request</button>}
          {p.return && <button className="btn-secondary" onClick={() => open("return")}>{d.status === "EXCEPTION" ? "Return for correction" : "Recall"}</button>}
          {p.resubmit && <button className="btn-secondary" onClick={() => open("resubmit")}>Resubmit as is</button>}
          {p.close && <button className="btn-secondary" onClick={() => open("close")}>Close</button>}
          {p.submit && <button className="btn-primary" onClick={() => open("submit")}><Send className="h-4 w-4" aria-hidden />Review &amp; submit to Elnexu</button>}
        </div>
      </div>

      {/* Progress */}
      {d.status !== "CANCELLED" && (
        <ol className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Workflow progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-col gap-1.5">
              <span className={clsx("h-1.5 rounded-full", i <= step ? (d.status === "EXCEPTION" && i === step ? "bg-bad-600" : "bg-brand-600") : "bg-line")} />
              <span className={clsx("text-xs", i <= step ? "font-medium text-ink" : "text-ink-subtle")}>{s}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mb-6 space-y-3">
        {d.status === "EXCEPTION" && (
          <Alert tone="bad" title={`Vendor exception: ${exceptionLabel(d.exceptionReason)}`}>
            {d.exceptionComment ?? "No further detail provided."} — raised {fmtDateTime(d.exceptionAt)}. Return it for correction, resubmit it as is, or cancel.
          </Alert>
        )}
        {d.status === "RETURNED" && <Alert tone="warn" title="Returned for correction">{d.returnComment}</Alert>}
        {d.status === "CANCELLED" && <Alert tone="info" title={`Cancelled ${fmtDateTime(d.cancelledAt)}`}>{d.cancelReason}</Alert>}
        {(d.status === "TREATED" || d.status === "CLOSED") && (
          <Alert tone="ok" title={`Treated by ${d.treatedByName} (${d.vendorName}) on ${fmtDateTime(d.treatedAt)}`}>{d.treatmentComment ?? undefined}</Alert>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card title="Terminal" actions={d.terminalId && <Link href={`/terminals/${d.terminalId}`} className="text-xs text-brand-700 hover:underline">Terminal lifecycle →</Link>}>
            <dl className="grid gap-4 sm:grid-cols-3">
              <KV label="Serial number" mono>{d.serialNumber}</KV>
              <KV label="TID" mono>{d.tid}</KV>
              <KV label="ISW TID" mono>{d.iswTid ?? "—"}</KV>
            </dl>
          </Card>

          {d.type === "REMAPPING" && d.previous ? (
            <Card title="Remapping">
              <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
                <div className="rounded border border-line bg-surface-sunken p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Current · version {d.previous.version}</div>
                  <dl className="space-y-3">
                    <KV label="Agent / merchant">{d.previous.agentName}</KV>
                    <KV label="Account" mono>{d.previous.account}</KV>
                    <KV label="Location">{d.previous.state}{d.previous.area ? ` — ${d.previous.area}` : ""}</KV>
                    <KV label="ANM">{d.previous.anmName}</KV>
                  </dl>
                </div>
                <div className="hidden items-center md:flex"><ArrowRight className="h-5 w-5 text-ink-subtle" aria-hidden /></div>
                <div className="rounded border border-brand-600/30 bg-brand-50/50 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-800">New mapping</div>
                  <MerchantDL d={d} account={account} onReveal={p.revealAccount ? reveal : undefined} />
                </div>
              </div>
              {d.reason && <p className="mt-4 text-sm"><span className="text-ink-muted">Reason:</span> {d.reason}</p>}
            </Card>
          ) : (
            <Card title="Agent / merchant">
              <MerchantDL d={d} account={account} onReveal={p.revealAccount ? reveal : undefined} grid />
            </Card>
          )}

          <Card title="Request information">
            <dl className="grid gap-4 sm:grid-cols-3">
              <KV label="Request ID" mono>{d.reference}</KV>
              <KV label="Created">{fmtDateTime(d.createdAt)}</KV>
              <KV label="Created by">{d.createdByName}</KV>
              <KV label="Submitted to vendor">{fmtDateTime(d.submittedAt)}</KV>
              <KV label="Submitted by">{d.submittedByName ?? "—"}</KV>
              <KV label="Vendor">{d.vendorName}</KV>
              <KV label="Opened by vendor">{fmtDateTime(d.vendorOpenedAt)}</KV>
              <KV label="Treated">{fmtDateTime(d.treatedAt)}</KV>
              <KV label="Treated by">{d.treatedByName ?? "—"}</KV>
              <KV label="Exceptions raised">{d.exceptionCount}</KV>
            </dl>
            {d.internalComment && (
              <div className="mt-5 rounded border border-line bg-surface-sunken p-3 text-sm">
                <div className="mb-1 text-xs font-medium text-ink-muted">Internal comment (not visible to vendor)</div>
                {d.internalComment}
              </div>
            )}
          </Card>
        </div>
        <aside>
          <Card title="Workflow timeline">
            <Timeline events={d.events} />
          </Card>
        </aside>
      </div>

      <Modal
        open={modal === "submit"}
        onClose={() => setModal(null)}
        size="lg"
        title="Review before submitting to Elnexu"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(null)}>Back</button>
            <button className="btn-primary" disabled={!confirm || busy} onClick={() => act({ action: "submit", confirm }, `${d.reference} submitted to Elnexu.`)}>
              {busy && <Spinner />} Submit to vendor
            </button>
          </>
        }
      >
        {err && <div className="mb-3"><Alert tone="bad">{err}</Alert></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded border border-line p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Terminal</div>
            <dl className="space-y-2.5">
              <KV label="Serial number" mono>{d.serialNumber}</KV>
              <KV label="TID" mono>{d.tid}</KV>
              <KV label="ISW TID" mono>{d.iswTid ?? "—"}</KV>
            </dl>
          </div>
          <div className="rounded border border-line p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Merchant / agent</div>
            <dl className="space-y-2.5">
              <KV label="Name">{d.agentName}</KV>
              <KV label="Account number" mono>{d.account}</KV>
              <KV label="Location">{d.state}{d.area ? ` — ${d.area}` : ""}</KV>
              <KV label="ANM">{d.anmName}</KV>
            </dl>
          </div>
        </div>
        <label className="mt-5 flex items-start gap-3 rounded border border-brand-600/30 bg-brand-50/50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I have reviewed the information and it is ready for vendor treatment.</span>
        </label>
        <p className="mt-3 text-xs text-ink-subtle">After submission the request is locked; any change will need a controlled, audited amendment.</p>
      </Modal>

      <Modal
        open={modal === "return" || modal === "cancel" || modal === "resubmit" || modal === "close"}
        onClose={() => setModal(null)}
        title={{ return: d.status === "EXCEPTION" ? "Return for correction" : "Recall from vendor", cancel: "Cancel request", resubmit: "Resubmit to Elnexu", close: "Close request" }[modal as "return"] ?? ""}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModal(null)}>Back</button>
            <button
              className={modal === "cancel" ? "btn-danger" : "btn-primary"}
              disabled={busy || ((modal === "return" || modal === "cancel") && comment.trim().length < 3)}
              onClick={() =>
                act(
                  modal === "cancel" ? { action: "cancel", reason: comment } : { action: modal, comment: comment || null },
                  { return: "Request returned for correction.", cancel: "Request cancelled.", resubmit: "Resubmitted to Elnexu.", close: "Request closed." }[modal as "return"],
                )
              }
            >
              {busy && <Spinner />} Confirm
            </button>
          </>
        }
      >
        {err && <div className="mb-3"><Alert tone="bad">{err}</Alert></div>}
        <label className="block">
          <span className="label">{modal === "cancel" ? "Reason for cancellation (required)" : modal === "return" ? "What needs to be corrected? (required)" : "Comment (optional)"}</span>
          <textarea className="input" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </label>
      </Modal>
    </div>
  );
}

function MerchantDL({ d, account, onReveal, grid }: { d: Detail; account: string | null; onReveal?: () => void; grid?: boolean }) {
  return (
    <dl className={grid ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-4" : "space-y-3"}>
      <KV label="Agent / merchant">{d.agentName}</KV>
      <div>
        <dt className="text-xs text-ink-muted">Account number</dt>
        <dd className="mt-0.5 flex items-center gap-2">
          <span className="ident">{account ?? d.account}</span>
          {onReveal && (
            <button onClick={onReveal} className="text-ink-subtle hover:text-ink" aria-label={account ? "Hide account number" : "Reveal full account number (audited)"} title={account ? "Hide" : "Reveal (audited)"}>
              {account ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </dd>
      </div>
      <KV label="Location">{d.state}{d.area ? ` — ${d.area}` : ""}</KV>
      <KV label="ANM">{d.anmName}</KV>
    </dl>
  );
}
