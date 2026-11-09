"use client";

/** Last-resort error page when the root layout itself fails. Plain markup: no app components are available. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8f7fc", color: "#111827", margin: 0 }}>
        <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 28 }}>Something went wrong</h1>
          <p style={{ color: "#4b5563" }}>CoreTech Recruiting couldn&apos;t load this page. Please try again in a moment.</p>
          {error.digest && <p style={{ color: "#6b7280", fontSize: 12 }}>Reference: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "10px 20px", borderRadius: 999, border: 0, background: "#6d28d9", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
