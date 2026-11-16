"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">The problem has been logged. Please try again; if it persists, contact support.</p>
      <button onClick={reset} className="btn-primary mt-6">Try again</button>
    </div>
  );
}
