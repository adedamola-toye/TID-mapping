"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { clsx } from "clsx";

type Toast = { id: number; tone: "ok" | "bad" | "info"; message: string };
const Ctx = createContext<{ push: (tone: Toast["tone"], message: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "bad" ? 8000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "bad" ? "alert" : "status"}
            className={clsx(
              "pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-pop",
              t.tone === "ok" && "border-ok-700/25 bg-surface text-ink",
              t.tone === "bad" && "border-bad-600/30 bg-bad-50 text-bad-700",
              t.tone === "info" && "border-line bg-surface text-ink",
            )}
          >
            {t.tone === "bad" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-700" aria-hidden />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss" className="text-ink-subtle hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
