"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { api, ApiError, download } from "@/lib/client/api";
import { Alert, Card, EmptyState, Spinner, clsx } from "@/components/ui";
import { IMPORT_KINDS, IMPORT_KIND_LABELS, type ImportKind } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";

interface Batch {
  id: string;
  reference: string;
  kind: ImportKind;
  status: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  importedRows: number;
  createdAt: string;
  uploadedByName: string | null;
}

const KIND_HELP: Record<ImportKind, string> = {
  TERMINAL_STOCK: "Elnexu's TID allocation sheet — Location, Terminal Serial Number, Current TID, ISW TID, Status/Comment. Registers terminals as available for mapping.",
  MAPPING: "Terminals to map to agents — Serial, TID, Agent/Merchant, Account Number, State, ANM (code or name). Creates requests ready for review.",
  REMAPPING: "Mapped terminals moving to new agents — Serial or TID, new Agent, Account, State, ANM, Reason. Serial/TID must match the terminal record.",
};

const STATUS_STYLE: Record<string, string> = {
  UPLOADED: "bg-surface-sunken text-ink-muted",
  VALIDATED: "bg-info-50 text-info-700",
  IMPORTED: "bg-ok-50 text-ok-700",
  CANCELLED: "bg-surface-sunken text-ink-subtle",
};

export function ImportsHome({ batches }: { batches: Batch[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<ImportKind>("MAPPING");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const r = await api<{ batchId: string }>("/api/imports", { body: fd });
      router.push(`/imports/${r.batchId}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Upload failed.");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[28rem_minmax(0,1fr)]">
      <Card title="New upload" className="self-start">
        <fieldset>
          <legend className="label">What does this file contain?</legend>
          <div className="space-y-2">
            {IMPORT_KINDS.map((k) => (
              <label key={k} className={clsx("flex cursor-pointer gap-3 rounded border p-3", kind === k ? "border-brand-600 bg-brand-50/60" : "border-line hover:bg-surface-sunken")}>
                <input type="radio" name="kind" className="mt-1 accent-brand-700" checked={kind === k} onChange={() => setKind(k)} />
                <span>
                  <span className="block text-sm font-medium">{IMPORT_KIND_LABELS[k]}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{KIND_HELP[k]}</span>
                  <button type="button" className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={(e) => { e.preventDefault(); download(`/api/imports/template?kind=${k}`); }}>
                    <Download className="h-3 w-3" aria-hidden /> Download template
                  </button>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div
          className={clsx("mt-5 flex flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors", drag ? "border-brand-600 bg-brand-50" : "border-line-strong")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
        >
          <UploadCloud className="h-8 w-8 text-ink-subtle" aria-hidden />
          {file ? (
            <p className="mt-2 text-sm font-medium"><FileSpreadsheet className="mr-1 inline h-4 w-4 text-brand-700" aria-hidden />{file.name} <span className="text-ink-subtle">({(file.size / 1024).toFixed(0)} KB)</span></p>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Drag an .xlsx or .csv file here</p>
          )}
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => input.current?.click()}>Choose file</button>
          <input ref={input} type="file" className="sr-only" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Choose file" />
          <p className="mt-2 text-2xs text-ink-subtle">Max 5 MB · up to 10,000 rows · first sheet is read · formulas are not evaluated</p>
        </div>
        {err && <div className="mt-4"><Alert tone="bad">{err}</Alert></div>}
        <button className="btn-primary mt-5 w-full" disabled={!file || busy} onClick={upload}>{busy && <Spinner />} Upload &amp; detect columns</button>
      </Card>

      <Card title="Recent batches" bodyClass="p-0" className="self-start">
        {batches.length === 0 ? (
          <EmptyState title="No batches uploaded yet." body="Uploaded files and their validation results will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0">
              <thead><tr>{["Batch", "Type", "File", "Status", "Rows", "Valid", "Errors", "Duplicates", "Imported", "Uploaded"].map((h) => <th key={h} className="table-th">{h}</th>)}</tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-sunken/70">
                    <td className="table-td"><Link href={`/imports/${b.id}`} className="ident whitespace-nowrap font-medium text-brand-700 hover:underline">{b.reference}</Link></td>
                    <td className="table-td whitespace-nowrap text-xs">{IMPORT_KIND_LABELS[b.kind]}</td>
                    <td className="table-td"><span className="block max-w-[12rem] truncate text-xs" title={b.fileName}>{b.fileName}</span></td>
                    <td className="table-td"><span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[b.status])}>{b.status[0] + b.status.slice(1).toLowerCase()}</span></td>
                    <td className="table-td num">{b.totalRows}</td>
                    <td className="table-td num">{b.validRows}</td>
                    <td className="table-td num text-bad-700">{b.errorRows || ""}</td>
                    <td className="table-td num text-warn-700">{b.duplicateRows || ""}</td>
                    <td className="table-td num text-ok-700">{b.importedRows || ""}</td>
                    <td className="table-td whitespace-nowrap text-xs text-ink-muted">{fmtDateTime(b.createdAt)}<br />{b.uploadedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
