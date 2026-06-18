/**
 * Route-level loading fallback — shown while a server component streams in.
 * A quiet, on-brand holding screen (gold wordmark + spinner) instead of a
 * blank flash.
 */
export default function Loading() {
  return (
    <main className="landing grain" aria-busy="true">
      <div className="landing-card" role="status" aria-live="polite">
        <span className="brand" style={{ fontSize: "1.4rem" }}>
          Sunday<b>Stage</b>
        </span>
        <div className="spinner" aria-hidden="true" />
        <p className="muted" style={{ marginTop: "1rem" }}>
          Laster …
        </p>
      </div>
    </main>
  );
}
