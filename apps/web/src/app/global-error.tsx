"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0f1a", color: "#f3f4f6", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#9ca3af" }}>
            {error.message || "The app failed to load. Try clearing the cache and restarting."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              borderRadius: 8,
              border: "none",
              background: "#6366f1",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#6b7280" }}>
            If this keeps happening, stop dev servers and run: npm run dev:clean
          </p>
        </main>
      </body>
    </html>
  );
}
