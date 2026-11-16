import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-xl font-semibold">We couldn&apos;t find that page or record</h1>
      <p className="mt-2 text-sm text-ink-muted">It may not exist, or you may not have access to it.</p>
      <Link href="/" className="btn-primary mt-6">Back to home</Link>
    </div>
  );
}
