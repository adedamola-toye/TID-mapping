import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";

// Every page is rendered per request so it carries the CSP nonce issued by the proxy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Wakeel Terminal Mapping", template: "%s · Wakeel Terminal Mapping" },
  description: "The Alternative Bank — Wakeel POS terminal mapping & remapping workflow.",
  robots: { index: false, follow: false },
  icons: { icon: "/brand/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a3e30" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG">
      <body className="min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
