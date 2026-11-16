"use client";

import { Field } from "@/components/ui";
import { NIGERIAN_STATES, REGIONS, REGION_LABELS, type Region, type RegionMap } from "@/lib/constants";

export function statesIn(regions: RegionMap, region: Region | "" | null | undefined): string[] {
  return NIGERIAN_STATES.filter((s) => !region || regions[s] === region);
}

/**
 * Two-step location picker: choose North Bank / South Bank, then drill down to a state.
 * Picking a state first fills in its bank. The state→bank assignment comes from the admin-managed map.
 */
export function RegionStatePicker({
  regions,
  region,
  state,
  onChange,
  mode = "form",
  stateError,
  required,
}: {
  regions: RegionMap;
  region: Region | "";
  state: string;
  onChange: (v: { region: Region | ""; state: string }) => void;
  /** "form" = labelled Field inputs; "filter" = compact filter selects with "All" options. */
  mode?: "form" | "filter";
  stateError?: string;
  required?: boolean;
}) {
  const unassigned = NIGERIAN_STATES.filter((s) => !regions[s]);
  const setRegion = (r: Region | "") => onChange({ region: r, state: state && r && regions[state] !== r ? "" : state });
  const setState = (s: string) => onChange({ region: s && regions[s] ? (regions[s] as Region) : region, state: s });

  const stateOptions = region ? (
    statesIn(regions, region).map((s) => <option key={s}>{s}</option>)
  ) : (
    <>
      {REGIONS.map((r) => (
        <optgroup key={r} label={REGION_LABELS[r]}>
          {statesIn(regions, r).map((s) => <option key={s}>{s}</option>)}
        </optgroup>
      ))}
      {unassigned.length > 0 && (
        <optgroup label="Not assigned to a bank">
          {unassigned.map((s) => <option key={s}>{s}</option>)}
        </optgroup>
      )}
    </>
  );

  if (mode === "filter") {
    return (
      <>
        <label className="text-xs">
          <span className="label">Bank</span>
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value as Region | "")} aria-label="Bank">
            <option value="">All banks</option>
            {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="label">State</span>
          <select className="input" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">{region ? `All ${REGION_LABELS[region]} states` : "All states"}</option>
            {stateOptions}
          </select>
        </label>
      </>
    );
  }

  return (
    <>
      <Field label="Bank (region)" required={required} hint="North Bank or South Bank — narrows the state list">
        {(p) => (
          <select {...p} className="input" value={region} onChange={(e) => setRegion(e.target.value as Region | "")}>
            <option value="">Select bank…</option>
            {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
          </select>
        )}
      </Field>
      <Field label="Location (state)" required={required} error={stateError}>
        {(p) => (
          <select {...p} className="input" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">{region ? `Select ${REGION_LABELS[region]} state…` : "Select state…"}</option>
            {stateOptions}
          </select>
        )}
      </Field>
    </>
  );
}
