import { redirect } from "next/navigation";
import { currentSession, homeFor } from "@/server/http";

export default async function Home() {
  const s = await currentSession();
  redirect(s ? homeFor(s.user.role) : "/login");
}
