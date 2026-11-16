"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)wk_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function handle(res: Response) {
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = "/login?expired=1";
    throw new ApiError("Your session has expired.", 401, "UNAUTHENTICATED");
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    let body: { error?: { message?: string; code?: string; fields?: Record<string, string> } } = {};
    if (ct.includes("application/json")) body = await res.json().catch(() => ({}));
    throw new ApiError(body.error?.message ?? "Request failed. Please try again.", res.status, body.error?.code, body.error?.fields);
  }
  return ct.includes("application/json") ? res.json() : res;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
  });
  return handle(res) as Promise<T>;
}

/** POST/GET that returns a file, then triggers a browser download. */
export async function download(path: string, body?: unknown, fallbackName = "export.xlsx") {
  const method = body === undefined ? "GET" : "POST";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Clipboard with a fallback for non-secure (http) contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
