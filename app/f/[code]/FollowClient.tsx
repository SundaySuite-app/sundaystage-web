"use client";

/**
 * Follow-along on the phone in the pew — text-only, big readable type.
 * The accessibility surface that replaces the desktop repo's companion PWA.
 *
 * "Follow in your language": each follower picks their own target language and
 * the live slide is auto-translated on their phone. The translation is fetched
 * from POST /api/sessions/<id>/translate on every seq change (server caches by
 * frame hash + language, so the cost is paid once per slide, not per phone).
 * On any miss — no key, gated slide, parse failure — we fall back to the
 * ORIGINAL language. The display contract is unchanged; this is purely additive
 * on the follower side.
 */
import { useEffect, useRef, useState } from "react";
import { useSessionState } from "@/lib/client/useSessionState";
import { usePresence } from "@/lib/client/usePresence";
import { t, detectLocale, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/locale/i18n";
import type { WebFrame } from "@/lib/webframe";

type TranslateResult = { text_lines: string[]; section_label: string | null };

// Per-device memory of the follower's chosen language, so the next service
// restores it instead of re-detecting the browser locale.
const LANG_KEY = "stage-follow-lang";

function loadLang(): (Locale | "off") | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LANG_KEY);
    if (raw === "off") return "off";
    if (raw && (LOCALES as readonly string[]).includes(raw)) return raw as Locale;
  } catch {
    // private mode / disabled storage — fall back to detection
  }
  return null;
}

function saveLang(v: Locale | "off"): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LANG_KEY, v);
  } catch {
    // best-effort
  }
}

export function FollowClient({ code }: { code: string }) {
  const { join, session, state, connected } = useSessionState(code);
  const [viewerId] = useState(() => `f-${Math.random().toString(36).slice(2)}`);
  usePresence(session?.id ?? null, { viewerId, role: "follow" });

  // The follower's chosen language. Restores a previous choice from this device,
  // else defaults to the browser locale; "off" means the explicit
  // original-language view.
  const [lang, setLangState] = useState<Locale | "off">(() => loadLang() ?? detectLocale());

  // Persist the choice and keep <html lang> in sync (LangSync listens).
  const setLang = (v: Locale | "off") => {
    setLangState(v);
    saveLang(v);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("stage:locale", { detail: v === "off" ? detectLocale() : v }),
      );
    }
  };

  // On mount, reflect the restored/detected language into <html lang> too.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("stage:locale", { detail: lang === "off" ? detectLocale() : lang }),
    );
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [translation, setTranslation] = useState<TranslateResult | null>(null);
  const [translating, setTranslating] = useState(false);
  const [aiOff, setAiOff] = useState(false);

  const frame = state.frame;
  const seq = state.seq;
  const ended = state.status === "ended";
  const sessionId = session?.id ?? null;

  // Fetch the translation for the current slide whenever the slide (seq) or the
  // chosen language changes. Stale responses are ignored via a request token.
  const reqToken = useRef(0);
  useEffect(() => {
    const token = ++reqToken.current;

    const skip =
      !sessionId ||
      lang === "off" ||
      !frame ||
      frame.kind !== "slide" ||
      !frame.text_lines ||
      frame.text_lines.length === 0 ||
      // The display already speaks a translation — show it as-is, don't fetch.
      (!!frame.translation_lines && frame.translation_lines.length > 0);

    (async () => {
      // Clear the previous slide's translation as the first async step (avoids
      // a synchronous setState in the effect body).
      setTranslation(null);
      if (skip) {
        setTranslating(false);
        return;
      }
      setTranslating(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame, target: lang }),
        });
        if (token !== reqToken.current) return;
        if (!res.ok) return;
        const body = (await res.json()) as {
          translation: TranslateResult | null;
          source: string;
        };
        if (token !== reqToken.current) return;
        setAiOff(body.source === "no_key");
        setTranslation(body.translation);
      } catch {
        // Network failure → silently keep the original language.
      } finally {
        if (token === reqToken.current) setTranslating(false);
      }
    })();
    // frame identity changes per seq; seq keeps the dep list honest+cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, seq, lang]);

  return (
    <div className="follow-root grain">
      <div className="follow-bar">
        <span className="brand" style={{ fontSize: "0.95rem" }}>
          Sunday<b>Stage</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <LanguagePicker value={lang} onChange={setLang} />
          <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span className={`conn-dot${connected ? "" : " off"}`} style={{ position: "static" }} />
            {ended ? "—" : t("follow.live")}
          </span>
        </span>
      </div>
      <div className="follow-body">
        {join === "not_found" ? (
          <p className="muted">{t("display.notFound")}</p>
        ) : ended ? (
          <p className="follow-text" style={{ color: "var(--ink-300)" }}>{t("follow.ended")}</p>
        ) : !frame || frame.kind === "black" || frame.kind === "logo" ? (
          <p className="muted">{t("follow.waiting")}</p>
        ) : (
          <SlideBody
            key={seq}
            frame={frame}
            lang={lang}
            translation={translation}
            translating={translating}
            aiOff={aiOff}
          />
        )}
      </div>
    </div>
  );
}

function LanguagePicker({
  value,
  onChange,
}: {
  value: Locale | "off";
  onChange: (v: Locale | "off") => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem" }}>
      <span className="muted" style={{ fontSize: "0.8rem" }}>{t("follow.language")}</span>
      <select
        aria-label={t("follow.language")}
        value={value}
        onChange={(e) => onChange(e.target.value as Locale | "off")}
        style={{
          background: "transparent",
          color: "inherit",
          border: "1px solid var(--ink-300)",
          borderRadius: "6px",
          padding: "0.2rem 0.4rem",
          font: "inherit",
        }}
      >
        <option value="off">{t("follow.original")}</option>
        {LOCALES.map((loc) => (
          <option key={loc} value={loc}>
            {LOCALE_LABELS[loc]}
          </option>
        ))}
      </select>
    </label>
  );
}

function SlideBody({
  frame,
  lang,
  translation,
  translating,
  aiOff,
}: {
  frame: WebFrame;
  lang: Locale | "off";
  translation: TranslateResult | null;
  translating: boolean;
  aiOff: boolean;
}) {
  // Which translation lines to show under each original line:
  //  1. the frame's own translation_lines (display contract, unchanged), else
  //  2. the per-pew fetched translation (when a language is chosen + available).
  const trLines =
    frame.translation_lines && frame.translation_lines.length > 0
      ? frame.translation_lines
      : lang !== "off" && translation
        ? translation.text_lines
        : null;

  const sectionLabel =
    lang !== "off" && translation?.section_label
      ? translation.section_label
      : frame.section_label;

  return (
    <div className="slide-fade">
      {sectionLabel ? (
        <div className="eyebrow" style={{ marginBottom: "0.8rem" }}>{sectionLabel}</div>
      ) : null}
      <div className="follow-text" aria-live="polite">
        {frame.kind === "message"
          ? frame.message
          : (frame.text_lines ?? []).map((line, i) => (
              <span key={i} style={{ display: "block" }}>
                {line}
                {trLines?.[i] ? <span className="tr">{trLines[i]}</span> : null}
              </span>
            ))}
      </div>
      {frame.reference ? <div className="follow-ref">{frame.reference}</div> : null}
      {lang !== "off" && translating ? (
        <div className="muted" style={{ marginTop: "0.8rem", fontSize: "0.8rem" }}>
          {t("follow.translating")}
        </div>
      ) : null}
      {lang !== "off" && aiOff ? (
        <div className="muted" style={{ marginTop: "0.8rem", fontSize: "0.8rem" }}>
          {t("follow.translateOff")}
        </div>
      ) : null}
    </div>
  );
}
