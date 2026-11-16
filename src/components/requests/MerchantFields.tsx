"use client";

import { Field } from "@/components/ui";
import { NIGERIAN_STATES, PRIORITIES } from "@/lib/constants";

export interface Anm {
  id: string;
  code: string;
  fullName: string;
  regions: string[];
}

export interface MerchantValues {
  agentName: string;
  accountNumber: string;
  state: string;
  area: string;
  anmId: string;
  priority: string;
  internalComment: string;
}

export const emptyMerchant: MerchantValues = { agentName: "", accountNumber: "", state: "", area: "", anmId: "", priority: "NORMAL", internalComment: "" };

export function MerchantFields({
  v,
  set,
  errors,
  anms,
  showComment = true,
}: {
  v: MerchantValues;
  set: (patch: Partial<MerchantValues>) => void;
  errors: Record<string, string>;
  anms: Anm[];
  showComment?: boolean;
}) {
  // ANMs covering the selected state first — still a controlled list, never free text.
  const covering = v.state ? anms.filter((a) => a.regions.includes(v.state)) : [];
  const others = anms.filter((a) => !covering.includes(a));
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Agent / merchant name" required error={errors.agentName}>
          {(p) => <input {...p} className="input" maxLength={150} autoComplete="off" value={v.agentName} onChange={(e) => set({ agentName: e.target.value })} placeholder="e.g. TANTA DYNAMIC ENTERPRISE" />}
        </Field>
      </div>
      <Field label="Account number" required error={errors.accountNumber} hint="10-digit NUBAN">
        {(p) => (
          <input
            {...p}
            className="input ident"
            inputMode="numeric"
            autoComplete="off"
            maxLength={10}
            value={v.accountNumber}
            onChange={(e) => set({ accountNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          />
        )}
      </Field>
      <Field label="ANM" required error={errors.anmId} hint={v.state && covering.length ? `${covering.length} ANM(s) cover ${v.state}` : "Select from the approved ANM list"}>
        {(p) => (
          <select {...p} className="input" value={v.anmId} onChange={(e) => set({ anmId: e.target.value })}>
            <option value="">Select ANM…</option>
            {covering.length > 0 && (
              <optgroup label={`Covers ${v.state}`}>
                {covering.map((a) => <option key={a.id} value={a.id}>{a.fullName} ({a.code})</option>)}
              </optgroup>
            )}
            <optgroup label={covering.length ? "Other ANMs" : "ANMs"}>
              {others.map((a) => <option key={a.id} value={a.id}>{a.fullName} ({a.code})</option>)}
            </optgroup>
          </select>
        )}
      </Field>
      <Field label="Location (state)" required error={errors.state}>
        {(p) => (
          <select {...p} className="input" value={v.state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">Select state…</option>
            {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </Field>
      <Field label="Area / LGA" error={errors.area} hint="Optional — town, LGA or market">
        {(p) => <input {...p} className="input" maxLength={120} value={v.area} onChange={(e) => set({ area: e.target.value })} />}
      </Field>
      <Field label="Priority" error={errors.priority}>
        {(p) => (
          <select {...p} className="input" value={v.priority} onChange={(e) => set({ priority: e.target.value })}>
            {PRIORITIES.map((x) => <option key={x} value={x}>{x[0] + x.slice(1).toLowerCase()}</option>)}
          </select>
        )}
      </Field>
      {showComment && (
        <div className="sm:col-span-2">
          <Field label="Internal comment" error={errors.internalComment} hint="Visible to Wakeel only — never shown to the vendor.">
            {(p) => <textarea {...p} className="input" rows={2} maxLength={1000} value={v.internalComment} onChange={(e) => set({ internalComment: e.target.value })} />}
          </Field>
        </div>
      )}
    </div>
  );
}
