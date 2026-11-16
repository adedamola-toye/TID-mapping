"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { Alert, Card, Spinner, clsx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { NIGERIAN_STATES, REGIONS, REGION_LABELS, type Region, type RegionMap } from "@/lib/constants";

type Col = Region | "UNASSIGNED";
const COL_LABEL: Record<Col, string> = { ...REGION_LABELS, UNASSIGNED: "Not assigned" };

export function RegionManager({ initial }: { initial: RegionMap }) {
  const toast = useToast();
  const [saved, setSaved] = useState<RegionMap>(initial);
  const [map, setMap] = useState<RegionMap>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changed = useMemo(() => NIGERIAN_STATES.filter((s) => map[s] !== saved[s]), [map, saved]);
  const cols: Col[] = [...REGIONS, ...(NIGERIAN_STATES.some((s) => !map[s]) ? (["UNASSIGNED"] as Col[]) : [])];

  const statesOf = (c: Col) => NIGERIAN_STATES.filter((s) => (c === "UNASSIGNED" ? !map[s] : map[s] === c));
  const set = (s: string, c: Col) => setMap({ ...map, [s]: c === "UNASSIGNED" ? null : c });

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const assignments = Object.fromEntries(changed.map((s) => [s, map[s]]));
      const r = await api<{ regions: RegionMap }>("/api/regions", { method: "PUT", body: { assignments } });
      setSaved(r.regions);
      setMap(r.regions);
      toast.push("ok", `${changed.length} state${changed.length === 1 ? "" : "s"} updated.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <Alert tone="bad">{err}</Alert>}
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-card">
        <span className="text-sm text-ink-muted">
          {changed.length ? <><strong className="text-ink">{changed.length}</strong> unsaved change{changed.length === 1 ? "" : "s"}: {changed.join(", ")}</> : "All changes saved."}
        </span>
        <div className="flex-1" />
        <button className="btn-secondary" disabled={!changed.length || busy} onClick={() => setMap(saved)}>Discard</button>
        <button className="btn-primary" disabled={!changed.length || busy} onClick={save}>{busy && <Spinner />}Save assignment</button>
      </div>
      <div className={clsx("grid gap-6", cols.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {cols.map((c) => {
          const list = statesOf(c);
          return (
            <Card key={c} title={<span>{COL_LABEL[c]} <span className="num ml-1 rounded-full bg-surface-sunken px-2 text-xs text-ink-muted">{list.length} states</span></span>} bodyClass="p-0">
              <ul className="divide-y divide-line">
                {list.map((s) => {
                  const other = (REGIONS.find((r) => r !== c) ?? REGIONS[0]) as Col;
                  return (
                    <li key={s} className={clsx("flex items-center gap-3 px-5 py-2", map[s] !== saved[s] && "bg-accent-100/40")}>
                      <span className="flex-1 text-sm">{s}{map[s] !== saved[s] && <span className="ml-2 text-2xs uppercase tracking-wide text-accent-700">changed</span>}</span>
                      <label className="sr-only" htmlFor={`r-${s}`}>Bank for {s}</label>
                      <select id={`r-${s}`} className="input w-36 py-1 text-xs" value={map[s] ?? "UNASSIGNED"} onChange={(e) => set(s, e.target.value as Col)}>
                        {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
                        <option value="UNASSIGNED">Not assigned</option>
                      </select>
                      {c !== "UNASSIGNED" && (
                        <button className="btn-ghost btn-sm" onClick={() => set(s, other)} title={`Move to ${COL_LABEL[other]}`} aria-label={`Move ${s} to ${COL_LABEL[other]}`}>
                          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </li>
                  );
                })}
                {list.length === 0 && <li className="px-5 py-8 text-center text-sm text-ink-muted">No states in this bank.</li>}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
