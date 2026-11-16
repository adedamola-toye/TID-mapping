/**
 * Generates FICTIONAL sample spreadsheets in /samples that mirror the legacy Elnexu sheet
 * (Location, Terminal Serial Number, Current TID, ISW TID, Status/Comment) and the new
 * mapping/remapping batch formats. Run: npx tsx scripts/make-samples.ts
 */
import ExcelJS from "exceljs";

async function sheet(file: string, title: string | null, header: string[], rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  if (title) ws.addRow([title]);
  ws.addRow(header).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 24));
  await wb.xlsx.writeFile(file);
}

async function main() {
  const states = ["Rivers", "Lagos", "Kano", "FCT", "Oyo", "Enugu"];
  await sheet(
    "samples/legacy-elnexu-tid-batch.xlsx",
    "ELNEXU TID ALLOCATION — SAMPLE (FICTIONAL DATA)",
    ["Location", "Terminal Serial Number", "Current TID", "ISW TID", "Status/Comment"],
    Array.from({ length: 12 }, (_, i) => [states[i % 6], `16624269${String(1000 + i).padStart(5, "0")}`, `2SMP${String(2000 + i)}`, `2ISS${String(3000 + i)}`, i === 3 ? "Having EOD Issues" : i % 4 === 0 ? "Done" : ""]),
  );
  await sheet(
    "samples/mapping-batch-example.xlsx",
    null,
    ["Terminal Serial Number", "TID", "ISW TID", "Agent Name", "Account Number", "State", "Area", "ANM", "Priority", "Comment"],
    [
      ["1662426901000", "2SMP2000", "2ISS3000", "SAMPLE AGENT ONE (TEST)", "9000000101", "Rivers", "Obio/Akpor", "ANM-008", "NORMAL", ""],
      ["1662426901001", "2SMP2001", "2ISS3001", "SAMPLE AGENT TWO (TEST)", "9000000102", "Lagos", "Ikeja", "ANM-001", "HIGH", ""],
      ["1662426901002", "2SMP2002", "", "", "12345", "Atlantis", "", "Unknown ANM", "", "Row with deliberate errors"],
    ],
  );
  console.log("Samples written to /samples");
}
main();
