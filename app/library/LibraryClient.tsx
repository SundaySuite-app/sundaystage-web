"use client";

/**
 * "My church's song library" — an OPTIONAL signed-in surface (the rest of the
 * app stays anonymous). Shows the church's published songs when signed in, or a
 * Sunday-account sign-in CTA otherwise. Sign-in needs the suite's OAuth provider
 * + this origin's /auth/callback whitelisted (Sunday platform config).
 */
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLibrary } from "@/lib/client/useLibrary";
import { t } from "@/lib/locale/i18n";

export function LibraryClient() {
  const { state, songs } = useLibrary(true);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/library`;
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  return (
    <main className="landing grain">
      <div className="landing-card" style={{ width: "min(40rem, 94vw)" }}>
        <div className="eyebrow">{t("landing.eyebrow")}</div>
        <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)", margin: "0.4rem 0 0" }}>
          {t("library.title")}
        </h1>

        {state === "loading" ? (
          <p className="sub">{t("op.libLoading")}</p>
        ) : state === "anon" ? (
          <>
            <p className="sub">{t("library.anon")}</p>
            <button className="btn btn--gold btn--lg" disabled={busy} onClick={() => void signIn()}>
              {t("library.signIn")}
            </button>
          </>
        ) : songs.length === 0 ? (
          <p className="sub">{t("library.empty")}</p>
        ) : (
          <div style={{ textAlign: "left", marginTop: "1.4rem", display: "grid", gap: "0.35rem" }}>
            {songs.map((s) => (
              <div key={s.id} className="op-template-row">
                <span style={{ flex: 1 }}>{s.title}</span>
                <span className="muted" style={{ fontSize: "0.75rem" }}>
                  {s.sections.length}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
