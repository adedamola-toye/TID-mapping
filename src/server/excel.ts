import "server-only";
import ExcelJS from "exceljs";
import { AppError } from "./errors";

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: { rowNumber: number; values: Record<string, string> }[];
}

export const UNLABELLED = /^Column [A-Z]+ \(no heading\)$/;

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP container

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") {
    // Long serials typed into Excel become numbers — render without exponent / decimals.
    return Number.isInteger(v) ? BigInt(Math.round(v)).toString() : String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    // Formulas: use the cached result only — formulas are never evaluated.
    if ("result" in v) return cellToString((v as { result: ExcelJS.CellValue }).result);
    if ("error" in v) return "";
  }
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** Find the header row: the first row (within the first 15) with ≥2 recognisable non-empty text cells. */
function detectHeaderRow(matrix: string[][], isKnownHeader: (h: string) => boolean): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const cells = matrix[i].filter((c) => c && c.trim());
    const known = cells.filter((c) => isKnownHeader(c)).length;
    const score = known * 10 + (cells.length >= 2 ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
    if (known >= 2) return i;
  }
  return best;
}

export async function parseUpload(
  fileName: string,
  buf: Buffer,
  opts: { maxRows: number; isKnownHeader: (h: string) => boolean },
): Promise<ParsedSheet> {
  const lower = fileName.toLowerCase();
  let matrix: string[][] = [];
  let sheetName = "CSV";
  if (lower.endsWith(".xlsx")) {
    if (buf.length < 4 || !buf.subarray(0, 4).equals(XLSX_MAGIC)) {
      throw new AppError("BAD_REQUEST", "This file is not a valid Excel (.xlsx) workbook.");
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new AppError("BAD_REQUEST", "The Excel file could not be read. It may be corrupted or password-protected.");
    }
    const ws = wb.worksheets.find((w) => w.state === "visible" && w.actualRowCount > 0) ?? wb.worksheets[0];
    if (!ws) throw new AppError("BAD_REQUEST", "The workbook has no worksheets.");
    sheetName = ws.name;
    if (ws.actualRowCount > opts.maxRows + 20) {
      throw new AppError("BAD_REQUEST", `The sheet has too many rows (max ${opts.maxRows}). Split the file into smaller batches.`);
    }
    const colCount = Math.min(ws.columnCount, 60);
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const vals: string[] = [];
      for (let c = 1; c <= colCount; c++) vals.push(cellToString(row.getCell(c).value));
      matrix[rowNumber - 1] = vals;
    });
    matrix = Array.from(matrix, (r) => r ?? []);
  } else if (lower.endsWith(".csv")) {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    if (/\u0000/.test(text)) throw new AppError("BAD_REQUEST", "This file is not a valid CSV.");
    matrix = parseCsv(text).map((r) => r.map((c) => c.trim()));
  } else {
    throw new AppError("BAD_REQUEST", "Unsupported file type. Upload an .xlsx or .csv file.");
  }

  const headerIdx = detectHeaderRow(matrix, opts.isKnownHeader);
  const rawHeaders = (matrix[headerIdx] ?? []).map((h) => h.replace(/\s+/g, " ").trim());
  const headers: string[] = [];
  const seen = new Map<string, number>();
  const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
  rawHeaders.forEach((h, i) => {
    // Unlabelled columns are named by their spreadsheet letter so users can recognise them.
    let name = h || `Column ${letter(i)} (no heading)`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    headers.push(name);
  });
  // Drop trailing empty columns.
  while (headers.length && UNLABELLED.test(headers[headers.length - 1]) &&
    matrix.slice(headerIdx + 1).every((r) => !(r[headers.length - 1] ?? "").trim())) {
    headers.pop();
  }
  if (headers.filter((h) => !UNLABELLED.test(h)).length === 0) {
    throw new AppError("BAD_REQUEST", "No header row was found. The first rows of the sheet must contain column titles.");
  }

  const rows: ParsedSheet["rows"] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (!r.some((c) => c && c.trim())) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, ci) => {
      values[h] = (r[ci] ?? "").slice(0, 500);
    });
    rows.push({ rowNumber: i + 1, values });
  }
  if (rows.length === 0) throw new AppError("BAD_REQUEST", "The file contains no data rows.");
  if (rows.length > opts.maxRows) {
    throw new AppError("BAD_REQUEST", `The file has ${rows.length} rows; the maximum per batch is ${opts.maxRows}.`);
  }
  return { sheetName, headers, rows };
}

/** Neutralise spreadsheet formula injection (CSV/Excel "DDE") in exported text cells. */
export function safeCell(v: unknown): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number") return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export async function buildWorkbook(
  sheets: { name: string; columns: { header: string; key: string; width?: number }[]; rows: Record<string, unknown>[] }[],
  meta?: { title?: string; generatedBy?: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Wakeel Terminal Mapping Platform";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 4) }));
    for (const r of s.rows) {
      const clean: Record<string, unknown> = {};
      for (const c of s.columns) clean[c.key] = safeCell(r[c.key]);
      ws.addRow(clean);
    }
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3B2E" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  if (meta?.title) {
    const ws = wb.addWorksheet("About");
    ws.addRow([meta.title]);
    ws.addRow([`Generated: ${new Date().toISOString()}`]);
    if (meta.generatedBy) ws.addRow([`Generated by: ${meta.generatedBy}`]);
    ws.addRow(["Confidential — The Alternative Bank internal use only."]);
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
