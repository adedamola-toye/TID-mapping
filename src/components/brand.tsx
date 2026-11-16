import { clsx } from "clsx";
import { LOGO_PATH, LOGO_VIEWBOX } from "./logo-path";

/** The Alternative Bank emblem in brand gold. */
export function Emblem({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={clsx("text-accent-500", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path fill="currentColor" d={LOGO_PATH} />
    </svg>
  );
}

/** Lock-up: emblem + "Wakeel" + "The Alternative Bank". */
export function BrandMark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <Emblem className="h-9 w-9 shrink-0" />
      <div className="leading-tight">
        <div className={clsx("text-[15px] font-semibold tracking-tight", inverted ? "text-white" : "text-ink")}>Wakeel</div>
        <div className={clsx("whitespace-nowrap text-2xs uppercase tracking-[0.08em]", inverted ? "text-accent-500" : "text-accent-700")}>The Alternative Bank</div>
      </div>
    </div>
  );
}
