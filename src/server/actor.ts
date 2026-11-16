import type { Role } from "@/lib/constants";

/** The authenticated principal performing an operation, plus request metadata for auditing. */
export interface Actor {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  vendorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** System actor for migrations / seed / background jobs. */
export const SYSTEM_ACTOR = {
  id: null as string | null,
  email: "system",
  fullName: "System",
  role: "SUPER_ADMIN" as Role,
  vendorId: null,
};
