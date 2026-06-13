"use client";

/** Create a web-operated session: name it (optional) → /o/<id>.
 * The bearer secret lands in localStorage — shown nowhere, sent on writes. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/locale/i18n";

export default function NewSessionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: "web", title }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const { id, code, secret } = (await res.json()) as {
        id: string;
        code: string;
        secret: string;
      };
      localStorage.setItem(`stage-session:${id}`, JSON.stringify({ secret, code }));
      router.push(`/o/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="landing grain">
      <div className="landing-card reveal">
        <div className="eyebrow">{t("landing.eyebrow")}</div>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 2.8rem)" }} className="display">
          {t("new.title")}
        </h1>
        <div style={{ margin: "1.6rem 0 1rem" }}>
          <input
            className="txt"
            placeholder={t("new.titlePlaceholder")}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
          />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="btn btn--gold btn--lg" disabled={busy} onClick={() => void create()}>
          {busy ? t("new.creating") : t("new.create")}
        </button>
      </div>
    </main>
  );
}
