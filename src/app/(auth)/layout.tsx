import { BrandMark, Emblem } from "@/components/brand";
import { ShieldCheck, ArrowRightLeft, ClipboardCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Emblem className="pointer-events-none absolute -bottom-24 -right-24 h-[34rem] w-[34rem] opacity-[0.08]" />
        <BrandMark inverted className="relative" />
        <div className="relative max-w-md">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-500">Operations Platform</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">POS terminal mapping, controlled end to end.</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            One source of truth for terminal allocation, mapping and remapping between Wakeel operations and the vendor — with every action recorded.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-white/80">
            <li className="flex gap-3"><ClipboardCheck className="h-5 w-5 shrink-0 text-accent-500" aria-hidden />Capture, review and release requests in batches</li>
            <li className="flex gap-3"><ArrowRightLeft className="h-5 w-5 shrink-0 text-accent-500" aria-hidden />Remap agents without changing serial or TID — history kept</li>
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-accent-500" aria-hidden />Role-based access and a tamper-evident audit trail</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Authorised users only. Activity on this system is monitored and recorded.</p>
      </aside>
      <main className="flex items-center justify-center bg-surface px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandMark className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
