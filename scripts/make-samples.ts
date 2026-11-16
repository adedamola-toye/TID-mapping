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
  // Mirrors the structure of the bank's real Elnexu sheet (unlabelled merchant column, blank row,
  // two-column Status/Comment, "@dropdown" column, mixed serial lengths, messy locations,
  // a replacement serial in the remarks column and a stray value far below) — values are fictional.
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("test data");
    ws.addRow(["  ", "Location", "Terminal Serial Number", "Current TID", "ISW TID", "Status/Comment", null, "@dropdown"]);
    ws.addRow([]);
    const rows: (string | number | null)[][] = [
      ["SAMPLE FARMS MKT NIG LTD", "FCT-Abuja", 43190001, "2SMP0S01", "2ALT9001"],
      ["SAMPLE DYNAMIC ENTERPRISE", "Rivers", 1662426900001, "2SMP0002", "2ALT9002", "Done"],
      ["SAMPLE ALUMINIUM SYSTEMS", "Rivers", 1662426900002, "2SMP0003", "2ALT9003", "Done"],
      ["SAMPLE LIMITED", "Lagos", 1662426900003, "2SMP0004", "2ALT9004", "Done", "Having EOD Issues"],
      ["SAMPLE LIMITED", null, 1662426900004, "2SMP0005", "2ALT9005", "Done"],
      ["SAMPLE LOGISTICS LIMITED", "10, Sample close Surulere Lagos", 1662426900005, "2SMP0006", "2ALT9006"],
      ["SAMPLE KUBAU ENTERPRISES", "Kaduna", 43190002, "2SMP0O07", "2ALT9007"],
      ["SAMPLE MULTI-TRADE INVESTMENT LTD", "Ogun", 1662426900006, "2SMP0008", "2ALT9008", "Done", "No Issue"],
      ["SAMPLE PHONE ACCESSORIES VENTURES", "kadunna", 80122600000001, "2SMP0009", "2ALT9009", "Done", 1662426900099, "2SMPZZ99"],
      ["SAMPLE COMMUNICATION CENTER", "TARABA", 43190003, "2SMP0010", "2ALT9010"],
      ["SAMPLE PHARMACEUTICALS LIMITED", "abuja", 1662426900007, "2SMP0011", "2ALT9011"],
    ];
    rows.forEach((r) => ws.addRow(r));
    for (let i = 0; i < 40; i++) ws.addRow([]);
    ws.addRow([null, 1662426900555]);
    ws.columns.forEach((c) => (c.width = 24));
    await wb.xlsx.writeFile("samples/legacy-elnexu-tid-batch.xlsx");
  }
  await sheet(
    "samples/mapping-batch-example.xlsx",
    null,
    ["Terminal Serial Number", "TID", "ISW TID", "Agent Name", "Account Number", "State", "Area", "ANM", "Priority", "Comment"],
    [
      ["1662426900001", "2SMP0002", "2ALT9002", "SAMPLE DYNAMIC ENTERPRISE", "9000000101", "Rivers", "Obio/Akpor", "ANM-008", "NORMAL", ""],
      ["1662426900002", "2SMP0003", "2ALT9003", "SAMPLE ALUMINIUM SYSTEMS", "9000000102", "Rivers", "", "ANM-008", "HIGH", ""],
      ["1662426900003", "2SMP0004", "", "", "12345", "Atlantis", "", "Unknown ANM", "", "Row with deliberate errors"],
    ],
  );
  console.log("Samples written to /samples");
}
main();
