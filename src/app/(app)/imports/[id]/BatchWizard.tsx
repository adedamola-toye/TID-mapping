"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Pencil, SkipForward } from "lucide-react";
import { api, ApiError, download } from "@/lib/client/api";
import { Alert, Card, Field, Modal, PageHeader, Pagination, Spinner, Tabs, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { IMPORT_KIND_LABELS, type ImportKind } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";

interface TargetField {
  key: string;
  label: string;
  required: boolean | "oneOf";
}
interface Row {
  id: string;
  rowNumber: number;
  status: "PENDING" | "VALID" | "ERROR" | "DUPLICATE" | "IMPORTED" | "SKIPPED";
  errors: Record<string, string>;
  warnings: string[];
  raw: Record<string, string>;
  normalized: Record<string, unknown>;
  entityId: string | null;
}
interface BatchData {
  batch: {
    id: string;
    reference: string;
    kind: ImportKind;
    status: "UPLOADED" | "VALIDATED" | "IMPORTED" | "CANCELLED";
    fileName: string;
    sheetName: string | null;
    headers: string[];
    columnMapping: Record<string, string | null> | null;
    totalRows: number;
    validRows: number;
    errorRows: number;
    duplicateRows: number;
    importedRows: number;
    createdAt: string;
    importedAt: string | null;
    uploadedByName: string | null;
  };
  fields: TargetField[];
  statusCounts: Record<string, number>;
  total: number;
  page: number;
  pageSize: number;
  rows: Row[];
}

const ROW_STYLE: Record<Row["status"], string> = {
  PENDING: "bg-surface-sunken text-ink-muted",
  VALID: "bg-ok-50 text-ok-700",
  ERROR: "bg-bad-50 text-bad-700",
  DUPLICATE: "bg-warn-50 text-warn-700",
  IMPORTED: "bg-brand-50 text-brand-800",
  SKIPPED: "bg-surface-sunken text-ink-subtle",
};

export function BatchWizard({ initial, canSubmit }: { initial: BatchData; canSubmit: boolean }) {
  const toast = useToast();
  const [d, setD] = useState<BatchData>(initial);
  const b = d.batch;
  const [mapping, setMapping] = useState<Record<string, string | null>>(b.columnMapping ?? {});
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [asDraft, setAsDraft] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; failed: number } | null>(null);
  const locked = b.status === "IMPORTED" || b.status === "CANCELLED";

  const reload = useCallback(
    async (opts: { status?: string; page?: number } = {}) => {
      const st = opts.status ?? filter;
      const qs = new URLSearchParams({ page: String(opts.page ?? 1), pageSize: "50", ...(st !== "all" ? { status: st } : {}) });
      setD(await api<BatchData>(`/api/imports/${b.id}?${qs}`));
    },
    [b.id, filter],
  );

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const validate = () =>
    run("validate", async () => {
      await api(`/api/imports/${b.id}`, { body: { op: "validate", mapping } });
      setFilter("all");
      await reload({ status: "all" });
      toast.push("ok", "Validation complete.");
    });

  const commit = () =>
    run("commit", async () => {
      const r = await api<{ imported: number; failed: number }>(`/api/imports/${b.id}`, { body: { op: "commit", asDraft } });
      setSummary(r);
      await reload({ status: "all" });
    });

  const saveRow = () =>
    run("row", async () => {
      await api(`/api/imports/${b.id}/rows/${edit!.id}`, { method: "PATCH", body: { values: editVals } });
      setEdit(null);
      await reload();
      toast.push("ok", `Row ${edit!.rowNumber} updated and re-validated.`);
    });

  const skipRow = (r: Row) =>
    run("skip", async () => {
      await api(`/api/imports/${b.id}/rows/${r.id}`, { method: "DELETE" });
      await reload();
    });

  const c = d.statusCounts;
  const shownHeaders = b.headers; // every column, in sheet order — nothing hidden
  const missingRequired = d.fields.filter((f) => f.required === true && !mapping[f.key]);
  const remapNeedsId = b.kind === "REMAPPING" && !mapping.serialNumber && !mapping.tid;
  const validated = b.status !== "UPLOADED";

  return (
    <div>
      <PageHeader
        eyebrow={IMPORT_KIND_LABELS[b.kind]}
        title={<span><span className="ident text-2xl">{b.reference}</span></span>}
        subtitle={`${b.fileName}${b.sheetName ? ` · sheet "${b.sheetName}"` : ""} · uploaded ${fmtDateTime(b.createdAt)} by ${b.uploadedByName ?? "—"}`}
        actions={
          <>
            {(c.ERROR || c.DUPLICATE) && validated ? (
              <button className="btn-secondary" onClick={() => download(`/api/imports/${b.id}?download=failed`)}><Download className="h-4 w-4" aria-hidden /> Download rows to correct</button>
            ) : null}
            {!locked && <button className="btn-ghost text-bad-700" onClick={() => run("cancel", async () => { await api(`/api/imports/${b.id}`, { body: { op: "cancel" } }); location.href = "/imports"; })}>Discard batch</button>}
          </>
        }
      />

      {err && <div className="mb-4"><Alert tone="bad">{err}</Alert></div>}

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Rows uploaded", b.totalRows, ""],
          ["Valid", c.VALID ?? 0, "text-ok-700"],
          ["Errors", c.ERROR ?? 0, "text-bad-700"],
          ["Duplicates", c.DUPLICATE ?? 0, "text-warn-700"],
          ["Skipped", c.SKIPPED ?? 0, "text-ink-muted"],
          ["Imported", c.IMPORTED ?? 0, "text-brand-800"],
        ].map(([l, v, cls]) => (
          <div key={l as string} className="rounded-md border border-line bg-surface p-4 shadow-card">
            <div className="text-xs text-ink-muted">{l}</div>
            <div className={clsx("num mt-1 text-2xl font-semibold", cls as string)}>{v as number}</div>
          </div>
        ))}
      </div>

      {(summary || b.status === "IMPORTED") && (
        <div className="mb-6">
          <Alert tone="ok" title={`Import complete — ${summary?.imported ?? b.importedRows} record(s) imported.`}>
            {summary?.failed ? `${summary.failed} row(s) failed final checks at import time and are marked as errors. ` : ""}
            {(c.ERROR || c.DUPLICATE) ? "Download the rows to correct, fix them and upload them as a new batch. " : ""}
            {b.kind !== "TERMINAL_STOCK" && (
              <>
                <Link className="font-medium underline" href={`/requests?batch=${b.id}&view=review`}>Review this batch&apos;s requests</Link>
                {canSubmit ? " and submit them to Elnexu in bulk." : "."}
              </>
            )}
            {b.kind === "TERMINAL_STOCK" && <Link className="font-medium underline" href="/terminals">View terminals</Link>}
          </Alert>
        </div>
      )}

      {!locked && (
        <Card title="1 · Map columns" className="mb-6">
          <p className="mb-4 text-sm text-ink-muted">We detected {b.headers.length} columns. Confirm which column holds each field. Required fields are marked *.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {d.fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required === true ? " *" : f.required === "oneOf" ? " (serial or TID)" : ""}`}>
                {(p) => (
                  <select {...p} className="input" value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}>
                    <option value="">— not in file —</option>
                    {b.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                )}
              </Field>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-subtle">
              {missingRequired.length || remapNeedsId ? `Still to map: ${[...missingRequired.map((f) => f.label), ...(remapNeedsId ? ["Serial or TID"] : [])].join(", ")}` : "All required fields mapped."}
            </p>
            <button className="btn-primary" disabled={!!busy || missingRequired.length > 0 || remapNeedsId} onClick={validate}>
              {busy === "validate" && <Spinner />} {validated ? "Re-validate all rows" : "Validate all rows"}
            </button>
          </div>
        </Card>
      )}

      {validated && (
        <Card
          title={locked ? "Rows" : "2 · Review rows"}
          bodyClass="p-0"
          actions={
            !locked && (
              <div className="flex flex-wrap items-center gap-3">
                {b.kind !== "TERMINAL_STOCK" && (
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <input type="checkbox" className="accent-brand-700" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} /> Import as drafts
                  </label>
                )}
                <button className="btn-primary" disabled={!!busy || !c.VALID} onClick={commit}>
                  {busy === "commit" && <Spinner />} Import {c.VALID ?? 0} valid row{c.VALID === 1 ? "" : "s"}
                </button>
              </div>
            )
          }
        >
          {!locked && (c.ERROR || c.DUPLICATE) ? (
            <div className="border-b border-line bg-warn-50 px-5 py-2.5 text-xs text-warn-700">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Rows with errors or duplicates will not be imported. Correct them here, skip them, or download them to fix offline.
            </div>
          ) : null}
          <div className="px-4 pt-1">
            <Tabs
              tabs={[
                { value: "all", label: "All", count: b.totalRows },
                { value: "ERROR", label: "Errors", count: c.ERROR ?? 0 },
                { value: "DUPLICATE", label: "Duplicates", count: c.DUPLICATE ?? 0 },
                { value: "VALID", label: "Valid", count: c.VALID ?? 0 },
                { value: "IMPORTED", label: "Imported", count: c.IMPORTED ?? 0 },
                { value: "SKIPPED", label: "Skipped", count: c.SKIPPED ?? 0 },
              ]}
              value={filter}
              onChange={(v) => {
                setFilter(v);
                reload({ status: v });
              }}
            />
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[800px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="table-th">Row</th>
                  <th className="table-th">Result</th>
                  {shownHeaders.map((h) => <th key={h} className="table-th whitespace-nowrap">{h}</th>)}
                  <th className="table-th">Issues</th>
                  <th className="table-th" />
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} className={clsx(r.status === "ERROR" && "bg-bad-50/30", r.status === "DUPLICATE" && "bg-warn-50/40")}>
                    <td className="table-td num text-ink-muted">{r.rowNumber}</td>
                    <td className="table-td"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", ROW_STYLE[r.status])}>{r.status[0] + r.status.slice(1).toLowerCase()}</span></td>
                    {shownHeaders.map((h) => {
                      const isAcct = mapping.accountNumber === h;
                      const v = r.raw[h] ?? "";
                      const isId = [mapping.serialNumber, mapping.tid, mapping.iswTid, mapping.accountNumber].includes(h);
                      return <td key={h} className={clsx("table-td whitespace-nowrap", isId && "ident")}>{isAcct && v.length > 4 ? `••••••${v.slice(-4)}` : v || <span className="text-ink-subtle">—</span>}</td>;
                    })}
                    <td className="table-td text-xs">
                      {Object.values(r.errors).map((e, i) => <div key={i} className="text-bad-700">{e}</div>)}
                      {r.warnings.map((w, i) => <div key={i} className="text-warn-700">{w}</div>)}
                      {r.status === "VALID" && !r.warnings.length && <CheckCircle2 className="h-4 w-4 text-ok-700" aria-label="Valid" />}
                      {r.status === "IMPORTED" && r.entityId && b.kind !== "TERMINAL_STOCK" && <Link href={`/requests/${r.entityId}`} className="text-brand-700 hover:underline">Open request</Link>}
                      {r.status === "IMPORTED" && r.entityId && b.kind === "TERMINAL_STOCK" && <Link href={`/terminals/${r.entityId}`} className="text-brand-700 hover:underline">Open terminal</Link>}
                    </td>
                    <td className="table-td whitespace-nowrap text-right">
                      {!locked && (r.status === "ERROR" || r.status === "DUPLICATE") && (
                        <>
                          <button className="btn-ghost btn-sm" onClick={() => { setEdit(r); setEditVals({ ...r.raw }); }} aria-label={`Correct row ${r.rowNumber}`}><Pencil className="h-3.5 w-3.5" aria-hidden />Correct</button>
                          <button className="btn-ghost btn-sm" onClick={() => skipRow(r)} aria-label={`Skip row ${r.rowNumber}`}><SkipForward className="h-3.5 w-3.5" aria-hidden />Skip</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {d.rows.length === 0 && <tr><td colSpan={shownHeaders.length + 4} className="table-td py-10 text-center text-ink-muted">No rows in this view.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => reload({ page: p })} />
        </Card>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title={`Correct row ${edit?.rowNumber ?? ""}`}
        footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy === "row"} onClick={saveRow}>{busy === "row" && <Spinner />} Save &amp; re-validate</button></>}
      >
        {edit && (
          <>
            <div className="mb-4 space-y-1">{Object.values(edit.errors).map((e, i) => <p key={i} className="text-sm text-bad-700">• {e}</p>)}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              {b.headers.map((h) => (
                <Field key={h} label={h}>
                  {(p) => <input {...p} className="input ident" autoComplete="off" value={editVals[h] ?? ""} onChange={(e) => setEditVals({ ...editVals, [h]: e.target.value })} />}
                </Field>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
