/** Display helpers shared by client and server. */
export function maskAccount(last4: string | null | undefined): string {
  return last4 ? `••••••${last4}` : "—";
}

const dtf = new Intl.DateTimeFormat("en-NG", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  timeZone: "Africa/Lagos",
});
const df = new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return dtf.format(typeof d === "string" ? new Date(d) : d);
}
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return df.format(typeof d === "string" ? new Date(d) : d);
}
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms)) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 48) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}
export function fmtNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : new Intl.NumberFormat("en-NG").format(n);
}
