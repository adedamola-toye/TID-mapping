import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-bad-600" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">Access restricted</h1>
      <p className="mt-2 text-sm text-ink-muted">Your role does not have access to this page. If you believe this is a mistake, contact a Wakeel administrator.</p>
      <Link href="/" className="btn-primary mt-6">Go to my home page</Link>
    </div>
  );
}
