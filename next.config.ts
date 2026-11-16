import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(process.env.SECURE_COOKIES === "true"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Docker/self-hosting uses the standalone server; Vercel manages its own output.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["exceljs", "pg"],
  // Keep Turbopack anchored to this project (otherwise it can pick up a
  // package-lock.json from a parent directory and mis-detect the workspace root).
  turbopack: { root: process.cwd() },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
    // Default is CPUs-1 (11 here), which exhausts memory during page-data
    // collection on smaller machines. Two workers is plenty and safe everywhere.
    cpus: 2,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
