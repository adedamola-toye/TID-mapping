"use client";

import { useState } from "react";
import { fmtNumber } from "@/lib/format";

/**
 * Minimal, dependency-free charts in the brand black & gold. Black vs gold differ strongly in
 * lightness (safe for colour-blind readers); gold is below 3:1 contrast on white, so every chart ships
 * a legend + table view.
 */

const SERIES = [
  { key: "submitted", label: "Submitted to vendor", color: "rgb(var(--brand-500))" },
  { key: "treated", label: "Treated", color: "rgb(var(--ink))" },
] as const;

export function DailyColumns({ rows }: { rows: { day: string; submitted: number; treated: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.submitted, r.treated]));
  const nice = Math.ceil(max / 5) * 5 || 5;
  const ticks = [0, nice / 2, nice];
  const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-NG", { day: "2-digit", month: "short" });
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-muted" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative flex h-48 gap-0 pl-8" role="img" aria-label="Requests submitted and treated per day over the last 14 days. A table view follows.">
        <div className="absolute inset-y-0 left-0 flex w-7 flex-col-reverse justify-between text-right text-2xs text-ink-subtle num">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0">{t}</span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-8 right-0 flex flex-col justify-between">
          {ticks.map((t) => (
            <div key={t} className="border-t border-line" />
          ))}
        </div>
        {rows.map((r, i) => (
          <div
            key={r.day}
            className="relative flex flex-1 items-end justify-center gap-[2px]"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && <div className="absolute inset-y-0 inset-x-0.5 rounded bg-surface-sunken" />}
            {SERIES.map((s) => (
              <div
                key={s.key}
                className="relative w-full max-w-[12px] rounded-t-[3px]"
                style={{ height: `${(r[s.key] / nice) * 100}%`, minHeight: r[s.key] ? 2 : 0, background: s.color }}
              />
            ))}
            {hover === i && (
              <div className="absolute bottom-full z-10 mb-2 w-max rounded border border-line bg-surface px-3 py-2 text-xs shadow-pop">
                <div className="mb-1 font-medium text-ink">{fmtDay(r.day)}</div>
                {SERIES.map((s) => (
                  <div key={s.key} className="flex items-center gap-2 text-ink-muted">
                    <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                    {s.label}: <span className="num font-medium text-ink">{r[s.key]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex pl-8 text-2xs text-ink-subtle">
        {rows.map((r, i) => (
          <div key={r.day} className="flex-1 text-center">{i % 2 === rows.length % 2 ? fmtDay(r.day) : ""}</div>
        ))}
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">View as table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr className="text-ink-muted"><th className="py-1">Day</th><th>Submitted</th><th>Treated</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t border-line num"><td className="py-1">{fmtDay(r.day)}</td><td>{r.submitted}</td><td>{r.treated}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Single-series horizontal bars (title names the series, so no legend). */
export function HBars({ rows, empty = "No data yet." }: { rows: { label: string; n: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3 text-sm" title={`${r.label}: ${r.n}`}>
          <span className="truncate text-ink-muted">{r.label}</span>
          <span className="h-3 rounded-r-[3px] bg-brand-500" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} />
          <span className="num text-right font-medium">{fmtNumber(r.n)}</span>
        </li>
      ))}
    </ul>
  );
}
