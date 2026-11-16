import type { Permission } from "@/server/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  perm?: Permission;
  roles?: string[];
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard:view" },
      { href: "/vendor", label: "Treatment Queue", icon: "ListChecks", perm: "vendor:queue" },
      { href: "/vendor?tab=treated", label: "Treated", icon: "CheckCircle2", perm: "vendor:queue" },
      { href: "/vendor?tab=exceptions", label: "Exceptions", icon: "AlertTriangle", perm: "vendor:queue" },
      { href: "/my-requests", label: "My Submissions", icon: "Inbox", roles: ["FIELD_SUBMITTER"] },
    ],
  },
  {
    label: "Terminal Mapping",
    items: [
      { href: "/requests/new/mapping", label: "New Mapping", icon: "PlusSquare", perm: "request:create" },
      { href: "/requests?type=MAPPING&view=queue", label: "Mapping Queue", icon: "ListChecks", perm: "request:view_all" },
      { href: "/requests?type=MAPPING&view=history", label: "Mapping History", icon: "History", perm: "request:view_all" },
    ],
  },
  {
    label: "Terminal Remapping",
    items: [
      { href: "/requests/new/remapping", label: "New Remapping", icon: "ArrowRightLeft", perm: "request:create" },
      { href: "/requests?type=REMAPPING&view=queue", label: "Remapping Queue", icon: "ListChecks", perm: "request:view_all" },
      { href: "/requests?type=REMAPPING&view=history", label: "Remapping History", icon: "History", perm: "request:view_all" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/requests?view=vendor", label: "With Elnexu", icon: "Send", perm: "request:view_all" },
      { href: "/requests?view=exceptions", label: "Exceptions", icon: "AlertTriangle", perm: "request:view_all" },
      { href: "/imports", label: "Batch Uploads", icon: "FileSpreadsheet", perm: "import:run" },
      { href: "/terminals", label: "Terminals", icon: "CreditCard", perm: "terminal:view" },
      { href: "/anms", label: "ANMs", icon: "Users", perm: "anm:view" },
      { href: "/reports", label: "Reports", icon: "BarChart3", perm: "report:view" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", icon: "UserCog", perm: "user:manage" },
      { href: "/admin/vendors", label: "Vendors", icon: "Building2", perm: "vendor:manage" },
      { href: "/admin/roles", label: "Roles & Permissions", icon: "KeyRound", perm: "user:manage" },
      { href: "/admin/audit", label: "Audit Logs", icon: "ScrollText", perm: "audit:view" },
      { href: "/admin/settings", label: "System Configuration", icon: "Settings", perm: "config:view" },
    ],
  },
];
