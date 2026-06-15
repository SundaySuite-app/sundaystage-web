"use client";

/**
 * Fullscreen network display — projector PCs, TVs, spare laptops. Joins with
 * the 6-digit code, renders frames as they arrive, keeps the screen awake,
 * hides the cursor, and self-heals through the polling fallback.
 */
import { useEffect, useState } from "react";
import { useSessionState } from "@/lib/client/useSessionState";
import { usePresence } from "@/lib/client/usePresence";
import { SlideRenderer } from "@/components/SlideRenderer";
import { t } from "@/lib/locale/i18n";

export function DisplayClient({ code }: { code: string }) {
  const { join, session, state, connected } = useSessionState(code);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [viewerId] = useState(() => `d-${Math.random().toString(36).slice(2)}`);
  usePresence(session?.id ?? null, { viewerId, role: "display" });

  // Keep the projector awake for the whole service.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(t: string): Promise<never> } }).wakeLock;
        if (wl) lock = (await wl.request("screen")) as unknown as { release(): Promise<void> };
      } catch {
        // wake lock is best-effort (older TV browsers)
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, []);

  // Auto-hide the cursor after 3 s of stillness.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setCursorVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCursorVisible(false), 3000);
    };
    onMove();
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      clearTimeout(timer);
    };
  }, []);

  if (join === "not_found") {
    return (
      <div className="display-root show-cursor" style={{ display: "grid", placeItems: "center" }}>
        <div className="state-quiet">
          <div className="display">{t("display.notFound")}</div>
          <p>{t("display.notFoundHint")}</p>
        </div>
      </div>
    );
  }

  const waiting = state.frame === null && state.status === "live";
  const ended = state.status === "ended";
  // Red badge whenever we're not getting live updates: "offline" before we ever
  // joined (running on the cached slide), "reconnecting" after a drop.
  const degraded = join === "offline" || (!connected && join === "ok");

  return (
    <div className={`display-root${cursorVisible ? " show-cursor" : ""}`}>
      {waiting || ended ? (
        <div className="slide-stage" style={{ background: "#000" }}>
          <div className="state-quiet">
            <span className="brand" style={{ fontSize: "1.4rem" }}>
              Sunday<b>Stage</b>
            </span>
            <div className="display" style={{ marginTop: "1.2rem" }}>
              {ended ? t("display.ended") : t("display.waiting")}
            </div>
            {!ended ? <div className="pin-echo">{code}</div> : null}
          </div>
        </div>
      ) : (
        <SlideRenderer frame={state.frame} animateKey={state.seq} />
      )}
      {degraded && !ended ? (
        <div className="conn-badge">
          <span className="conn-dot off" />
          {join === "offline" ? t("display.offline") : t("display.reconnecting")}
        </div>
      ) : null}
    </div>
  );
}
