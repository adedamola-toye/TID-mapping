import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/http";
import { ROLE_PERMISSIONS } from "@/server/rbac";
import { config } from "@/server/config";
import { AppShell } from "@/components/shell/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await currentSession();
  if (!s) redirect("/login");
  return (
    <Suspense>
      <AppShell
        user={{ fullName: s.user.fullName, email: s.user.email, role: s.user.role, vendorName: s.user.vendorName }}
        permissions={[...ROLE_PERMISSIONS[s.user.role]]}
        idleMinutes={config().SESSION_IDLE_TIMEOUT_MINUTES}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}
