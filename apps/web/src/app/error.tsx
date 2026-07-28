"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card mx-auto max-w-lg text-center">
      <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
      <p className="mt-2 text-sm text-gray-400">{error.message}</p>
      <button className="btn-primary mt-6" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
