"use client";

import Link from "next/link";

/**
 * Route-level error boundary — a transient render/runtime error shows a
 * friendly recovery screen instead of a blank, unrecoverable page. Mirrors the
 * suite pattern (see SundayChess / SundayTicTacToe).
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="landing grain">
      <div className="landing-card" role="alert">
        <div className="eyebrow">SundayStage</div>
        <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>Noe gikk galt</h1>
        <p className="sub">
          Prøv på nytt — økten lever videre på serveren, så ingenting går tapt.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            justifyContent: "center",
            marginTop: "0.4rem",
            flexWrap: "wrap",
          }}
        >
          <button className="btn btn--gold btn--lg" onClick={() => reset()}>
            Prøv igjen
          </button>
          <Link className="btn btn--lg" href="/">
            Til forsiden
          </Link>
        </div>
      </div>
    </main>
  );
}
