import Link from "next/link";

/**
 * 404 — a missing route (e.g. a mistyped session link) lands here instead of
 * the default bare Next.js page. On-brand, with a route back to the front door.
 */
export default function NotFound() {
  return (
    <main className="landing grain">
      <div className="landing-card">
        <div className="eyebrow">SundayStage</div>
        <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>Fant ikke siden</h1>
        <p className="sub">
          Lenken finnes ikke lenger, eller koden er feil. Sjekk koden fra
          operatøren og prøv igjen.
        </p>
        <Link className="btn btn--gold btn--lg" href="/">
          Til forsiden
        </Link>
      </div>
    </main>
  );
}
