"use client";

/**
 * The light operator console. Two jobs:
 *  - WEB sessions: paste lyrics → slides, tap to show, next/prev/black/logo —
 *    every action computes a WebFrame client-side and POSTs the shared /frame
 *    endpoint (same write path as the desktop forwarder).
 *  - DESKTOP sessions: the slide grid is hidden; the transport buttons become
 *    a REMOTE CONTROL that broadcasts commands the desktop app acts on.
 * The session secret lives in localStorage from /new (or via the desktop
 * deep link `/o/<id>#s=<secret>` which we persist and scrub from the URL).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { pasteToSlides, type SlideDef } from "@/lib/sections";
import { WEBFRAME_VERSION, type WebFrame } from "@/lib/webframe";
import { usePresence } from "@/lib/client/usePresence";
import { SlideRenderer } from "@/components/SlideRenderer";
import { t } from "@/lib/locale/i18n";
import type { RemoteCommand } from "@/lib/realtime";

interface Stored {
  secret: string;
  code: string;
}

type Mode = "web" | "desktop";

export function OperatorClient({ id }: { id: string }) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [mode, setMode] = useState<Mode>("web");
  const [slides, setSlides] = useState<SlideDef[]>([]);
  const [current, setCurrent] = useState(-1); // -1 = nothing shown yet
  const [overlay, setOverlay] = useState<"none" | "black" | "logo">("none");
  const [paste, setPaste] = useState("");
  const [lost, setLost] = useState(false);
  const [cmdSeq, setCmdSeq] = useState(0);
  const [viewerId] = useState(() => `o-${Math.random().toString(36).slice(2)}`);

  const viewers = usePresence(id, { viewerId, role: "operator" });
  const displayCount = viewers.filter((v) => v.role === "display").length;
  const followCount = viewers.filter((v) => v.role === "follow").length;

  // Resolve the secret: localStorage, or the desktop deep-link fragment.
  // (Async tick so hydration finishes before state moves — keeps the React
  // compiler's no-sync-setState-in-effect rule honest.)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const fromHash = /[#&]s=([a-f0-9]{64})/.exec(window.location.hash)?.[1];
      const key = `stage-session:${id}`;
      if (fromHash) {
        const code = /[#&]c=(\d{6})/.exec(window.location.hash)?.[1] ?? "";
        localStorage.setItem(key, JSON.stringify({ secret: fromHash, code }));
        history.replaceState(null, "", window.location.pathname); // scrub
      }
      const raw = localStorage.getItem(key);
      if (raw) setStored(JSON.parse(raw) as Stored);
      else setLost(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Session metadata: origin decides web-operate vs remote-control; restore
  // a saved setlist after refresh.
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/sessions/${id}/state`);
      if (!res.ok) {
        setLost(true);
        return;
      }
      const body = (await res.json()) as {
        status: "live" | "ended";
        origin: Mode;
        setlist: { slides?: SlideDef[]; current?: number } | null;
      };
      if (body.status === "ended") setLost(true);
      setMode(body.origin);
      if (body.setlist?.slides) {
        setSlides(body.setlist.slides);
        setCurrent(body.setlist.current ?? -1);
      }
    })();
  }, [id]);

  const auth = useMemo(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${stored?.secret ?? ""}` }),
    [stored?.secret],
  );

  const postFrame = useCallback(
    async (frame: WebFrame) => {
      const res = await fetch(`/api/sessions/${id}/frame`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ frame }),
      });
      if (res.status === 410 || res.status === 404) setLost(true);
    },
    [auth, id],
  );

  const sendCommand = useCallback(
    async (cmd: RemoteCommand) => {
      const next = cmdSeq + 1;
      setCmdSeq(next);
      await fetch(`/api/sessions/${id}/command`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ cmd, cmd_seq: next }),
      });
    },
    [auth, cmdSeq, id],
  );

  const saveSetlist = useCallback(
    (nextSlides: SlideDef[], nextCurrent: number) => {
      void fetch(`/api/sessions/${id}/setlist`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ setlist: { slides: nextSlides, current: nextCurrent } }),
      });
    },
    [auth, id],
  );

  const frameForSlide = (s: SlideDef): WebFrame => ({
    v: WEBFRAME_VERSION,
    kind: "slide",
    text_lines: s.lines,
    section_label: s.label ?? undefined,
  });

  function showSlide(index: number) {
    if (index < 0 || index >= slides.length) return;
    setCurrent(index);
    setOverlay("none");
    void postFrame(frameForSlide(slides[index]));
    saveSetlist(slides, index);
  }

  function step(delta: number) {
    if (mode === "desktop") {
      void sendCommand(delta > 0 ? "next" : "prev");
      return;
    }
    showSlide(current + delta);
  }

  function toggleOverlay(kind: "black" | "logo") {
    if (mode === "desktop") {
      void sendCommand(kind);
      return;
    }
    if (overlay === kind) {
      setOverlay("none");
      if (current >= 0) void postFrame(frameForSlide(slides[current]));
      return;
    }
    setOverlay(kind);
    void postFrame({ v: WEBFRAME_VERSION, kind });
  }

  function addSlides() {
    const parsed = pasteToSlides(paste);
    if (parsed.length === 0) return;
    const next = [...slides, ...parsed];
    setSlides(next);
    setPaste("");
    saveSetlist(next, current);
  }

  async function endSession() {
    if (!window.confirm(t("op.endConfirm"))) return;
    await fetch(`/api/sessions/${id}/end`, { method: "POST", headers: auth });
    setLost(true);
  }

  const host =
    typeof window !== "undefined" ? window.location.host : "stage.sundaysuite.app";

  if (lost) {
    return (
      <main className="landing grain">
        <div className="landing-card">
          <p className="muted">{t("op.sessionLost")}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="op-root grain">
      <div className="op-top">
        <span className="brand">
          Sunday<b>Stage</b>
        </span>
        <div style={{ textAlign: "center" }}>
          <div className="muted" style={{ fontSize: "0.72rem" }}>
            {t("op.shareHint", { host })}
          </div>
          <div className="op-code">{stored?.code ?? "······"}</div>
        </div>
        <div className="op-meta">
          {t("op.displays", { n: displayCount })} · {t("op.followers", { n: followCount })}
          {mode === "desktop" ? <> · {t("op.remote")}</> : null}
          <button className="btn btn--ghost" style={{ marginLeft: "0.8rem" }} onClick={() => void endSession()}>
            {t("op.end")}
          </button>
        </div>
      </div>

      {mode === "web" ? (
        <div>
          <div style={{ padding: "1rem 0 0" }}>
            <textarea
              className="paste"
              placeholder={t("op.paste")}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem" }}>
              <button className="btn btn--gold" disabled={!paste.trim()} onClick={addSlides}>
                {t("op.addSlides")}
              </button>
              {slides.length > 0 ? (
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setSlides([]);
                    setCurrent(-1);
                    saveSetlist([], -1);
                  }}
                >
                  {t("op.clear")}
                </button>
              ) : null}
            </div>
          </div>

          {slides.length === 0 ? (
            <p className="muted" style={{ padding: "1.4rem 0" }}>{t("op.empty")}</p>
          ) : (
            <div className="op-grid">
              {slides.map((s, i) => (
                <button
                  key={i}
                  className={`op-slide${i === current && overlay === "none" ? " active" : ""}`}
                  onClick={() => showSlide(i)}
                >
                  {s.label ? <span className="lbl">{s.label}</span> : null}
                  {s.lines.slice(0, 4).map((l, j) => (
                    <span key={j} style={{ display: "block" }}>{l}</span>
                  ))}
                </button>
              ))}
            </div>
          )}

          {current >= 0 && overlay === "none" ? (
            <div style={{ position: "fixed", right: "1rem", bottom: "5.6rem", width: "13rem", aspectRatio: "16/9", borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)" }}>
              <SlideRenderer frame={frameForSlide(slides[current])} animateKey={current} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: "grid", placeItems: "center" }}>
          <p className="muted" style={{ maxWidth: "26rem", textAlign: "center" }}>{t("op.remote")}</p>
        </div>
      )}

      <div className="op-controls">
        <button className="btn" onClick={() => toggleOverlay("black")}>
          {t("op.black")}
        </button>
        <button className="btn btn--lg" onClick={() => step(-1)} disabled={mode === "web" && current <= 0}>
          ← {t("op.prev")}
        </button>
        <button
          className="btn btn--gold btn--lg op-next"
          onClick={() => step(1)}
          disabled={mode === "web" && current >= slides.length - 1 && current !== -1 && slides.length === 0}
        >
          {t("op.next")} →
        </button>
        <button className="btn" onClick={() => toggleOverlay("logo")}>
          {t("op.logo")}
        </button>
      </div>
    </div>
  );
}
