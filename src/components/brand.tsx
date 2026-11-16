import { clsx } from "clsx";

/** Wordmark: geometric mark + "Wakeel" with the bank's name. Swap for the official logo asset when available. */
export function BrandMark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <div className={clsx("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" className={inverted ? "fill-white/10" : "fill-brand-800"} />
        <path d="M7 10l4 12 5-9 5 9 4-12" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-500" />
      </svg>
      <div className="leading-tight">
        <div className={clsx("text-[15px] font-semibold tracking-tight", inverted ? "text-white" : "text-ink")}>Wakeel</div>
        <div className={clsx("text-2xs uppercase tracking-[0.14em]", inverted ? "text-white/60" : "text-ink-subtle")}>The Alternative Bank</div>
      </div>
    </div>
  );
}
