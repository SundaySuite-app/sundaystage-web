"use client";

/**
 * Landing — the front door for displays and followers: a big segmented PIN
 * entry, then choose "screen" or "phone". Operators without the desktop app
 * start a web session from here.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isValidPin } from "@/lib/codes";
import { splitAccent, t } from "@/lib/locale/i18n";

export default function LandingPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    setError(null);
    if (d && i < 5) inputs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  }

  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setDigits(text.split(""));
      inputs.current[5]?.focus();
    }
  }

  async function join(mode: "d" | "f" | "s") {
    if (!isValidPin(code)) return;
    setBusy(true);
    const res = await fetch(`/api/sessions/by-code/${code}`);
    setBusy(false);
    if (!res.ok) {
      setError(t("landing.codeInvalid"));
      return;
    }
    router.push(`/${mode}/${code}`);
  }

  return (
    <main className="landing grain">
      <div className="landing-card reveal">
        <div className="eyebrow">{t("landing.eyebrow")}</div>
        <h1>
          {splitAccent(t("landing.title")).map((seg, i) =>
            seg.em ? (
              <span key={i} className="accent">
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </h1>
        <p className="sub">{t("landing.sub")}</p>

        <div className="pin" onPaste={onPaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              inputMode="numeric"
              autoFocus={i === 0}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              aria-label={`Siffer ${i + 1}`}
            />
          ))}
        </div>
        {error ? <p className="error-text" style={{ marginTop: "0.8rem" }}>{error}</p> : null}

        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center", marginTop: "1.4rem", flexWrap: "wrap" }}>
          <button className="btn btn--gold btn--lg" disabled={!isValidPin(code) || busy} onClick={() => void join("d")}>
            {t("landing.join")}
          </button>
          <button className="btn btn--lg" disabled={!isValidPin(code) || busy} onClick={() => void join("f")}>
            {t("landing.follow")}
          </button>
        </div>

        <div style={{ marginTop: "0.8rem" }}>
          <button
            className="btn btn--ghost"
            disabled={!isValidPin(code) || busy}
            onClick={() => void join("s")}
          >
            {t("landing.scene")}
          </button>
        </div>

        <hr className="hr-faint" />
        <p className="muted">
          {t("landing.start")}{" "}
          <Link href="/new" style={{ color: "var(--gold-300)" }}>
            {t("landing.startCta")} →
          </Link>
        </p>
      </div>
    </main>
  );
}
