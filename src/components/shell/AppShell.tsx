"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutDashboard, ListChecks, CheckCircle2, AlertTriangle, Inbox, PlusSquare, History, ArrowRightLeft, Send,
  FileSpreadsheet, CreditCard, Users, BarChart3, UserCog, Building2, KeyRound, ScrollText, Settings, Circle, Map as MapIcon,
  Menu, ChevronDown, UserRound, LogOut, Bell,
} from "lucide-react";
import { clsx } from "clsx";
import { BrandMark } from "@/components/brand";
import { api } from "@/lib/client/api";
import { NAV } from "./nav";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { fmtDateTime } from "@/lib/format";

interface ShellUser {
  fullName: string;
  email: string;
  role: Role;
  vendorName: string | null;
}

const ICONS: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  LayoutDashboard, ListChecks, CheckCircle2, AlertTriangle, Inbox, PlusSquare, History, ArrowRightLeft, Send,
  FileSpreadsheet, CreditCard, Users, BarChart3, UserCog, Building2, KeyRound, ScrollText, Settings, Map: MapIcon,
};

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Circle;
  return <C className={className} aria-hidden />;
}

export function AppShell({ user, permissions, idleMinutes, children }: { user: ShellUser; permissions: string[]; idleMinutes: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = pathname + (sp.toString() ? `?${sp.toString()}` : "");
  useEffect(() => setOpen(false), [current]);

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.perm || permissions.includes(i.perm)) && (!i.roles || i.roles.includes(user.role))),
  })).filter((g) => g.items.length);

  const isActive = (href: string) => {
    const [p, q] = href.split("?");
    if (q) {
      const want = new URLSearchParams(q);
      if (pathname !== p) return false;
      for (const [k, v] of want) if (sp.get(k) !== v) return false;
      return true;
    }
    if (p === "/vendor") return pathname === "/vendor" && !sp.get("tab");
    if (p === "/requests/new/mapping" || p === "/requests/new/remapping") return pathname === p;
    return pathname === p || (pathname.startsWith(p + "/") && !["/requests"].includes(p));
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-white/10 px-5">
        <Link href="/" aria-label="Home"><BrandMark inverted /></Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => (
          <div key={gi} className="mb-5">
            {g.label && <div className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-[0.14em] text-white/40">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((i) => {
                const active = isActive(i.href);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] transition-colors",
                        active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon name={i.icon} className={clsx("h-4 w-4", active ? "text-accent-500" : "text-white/50")} />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-5 py-3 text-2xs text-white/40">Confidential · Authorised use only</div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-brand-900 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-brand-900 shadow-pop">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
        <button className="btn-ghost -ml-2 p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1" />
        <Notifications />
        <UserMenu user={user} />
      </header>
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <IdleTimeout minutes={idleMinutes} />
    </div>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const initials = user.fullName.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2.5 rounded px-1.5 py-1 hover:bg-surface-sunken" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[180px] truncate text-sm font-medium leading-tight">{user.fullName}</span>
          <span className="block text-2xs text-ink-muted">{user.vendorName ? `${user.vendorName} · ` : ""}{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-ink-subtle sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 rounded-md border border-line bg-surface py-1 shadow-pop">
          <div className="border-b border-line px-3 py-2 text-xs text-ink-muted">{user.email}</div>
          <Link role="menuitem" href="/account" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-sunken"><UserRound className="h-4 w-4" aria-hidden />My account & security</Link>
          <button role="menuitem" onClick={() => logout()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-bad-700 hover:bg-bad-50"><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
        </div>
      )}
    </div>
  );
}

async function logout(expired = false) {
  try {
    await api("/api/auth/logout", { method: "POST", body: {} });
  } catch {
    /* ignore */
  }
  window.location.assign(expired ? "/login?expired=1" : "/login");
}

interface Notif {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Notif[]; unread: number }>({ items: [], unread: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api<{ items: Notif[]; unread: number }>("/api/notifications").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  async function markAll() {
    await api("/api/notifications", { body: { all: true } }).catch(() => {});
    load();
  }
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative p-2" aria-label={`Notifications (${data.unread} unread)`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bell className="h-5 w-5" />
        {data.unread > 0 && <span className="num absolute right-1 top-1 min-w-[16px] rounded-full bg-bad-600 px-1 text-[10px] font-semibold leading-4 text-white">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-md border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {data.unread > 0 && <button className="text-xs text-brand-700 hover:underline" onClick={markAll}>Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {data.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-muted">You&apos;re all caught up.</li>}
            {data.items.map((n) => (
              <li key={n.id} className={clsx("border-b border-line last:border-0", !n.readAt && "bg-brand-50/50")}>
                <a
                  href={n.link ?? "#"}
                  onClick={() => api("/api/notifications", { body: { ids: [n.id] } }).catch(() => {})}
                  className="block px-4 py-3 hover:bg-surface-sunken"
                >
                  <div className="flex gap-2">
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>}
                      <p className="mt-1 text-2xs text-ink-subtle">{fmtDateTime(n.createdAt)}</p>
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Warns before the server-side idle timeout and signs the user out when it elapses. */
function IdleTimeout({ minutes }: { minutes: number }) {
  const [warn, setWarn] = useState(false);
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
    };
    const evs = ["mousedown", "keydown", "touchstart", "scroll"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      const limit = minutes * 60_000;
      if (idle >= limit) logout(true);
      else setWarn(idle >= limit - 2 * 60_000);
    }, 10_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [minutes]);
  if (!warn) return null;
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-md border border-warn-700/30 bg-warn-50 px-4 py-3 text-sm text-warn-700 shadow-pop">
      <div className="flex items-center justify-between gap-3">
        <span>You will be signed out soon due to inactivity.</span>
        <button
          className="btn-secondary btn-sm"
          onClick={() => {
            last.current = Date.now();
            setWarn(false);
            api("/api/me").catch(() => {});
          }}
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
