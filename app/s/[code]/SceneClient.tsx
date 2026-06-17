"use client";

/**
 * Scene / confidence monitor for musicians — open /s/<code> on a phone, tablet
 * or stage monitor and see the CURRENT lyrics big, the NEXT slide, and a clock,
 * so the band always knows what is coming. Reuses the same join / broadcast /
 * poll / merge loop as the display; the "next" preview rides on the frame's
 * optional next_* fields (populated by the web operator — desktop-driven
 * sessions degrade gracefully to current-only).
 */
import { useEffect, useState } from "react";
import { useSessionState } from "@/lib/client/useSessionState";
import { usePresence } from "@/lib/client/usePresence";
import { t } from "@/lib/locale/i18n";

export function SceneClient({ code }: { code: string }) {
  const { join, session, state, connected } = useSessionState(code);
  const [viewerId] = useState(() => `s-${Math.random().toString(36).slice(2)}`);
  usePresence(session?.id ?? null, { viewerId, role: "scene" });

  const clock = useClock();
  useWakeLock();

  if (join === "not_found") {
    return (
      <div className="scene-root" style={{ placeItems: "center", gridTemplateRows: "1fr" }}>
        <div className="state-quiet">
          <div className="display">{t("display.notFound")}</div>
          <p>{t("display.notFoundHint")}</p>
        </div>
      </div>
    );
  }

  const frame = state.frame;
  const ended = state.status === "ended";
  const degraded = join === "offline" || (!connected && join === "ok");
  const showSlide = !!frame && frame.kind === "slide";
  const overlay = !!frame && (frame.kind === "black" || frame.kind === "logo");
  const hasNext = showSlide && !!frame.next_lines && frame.next_lines.length > 0;

  return (
    <div className="scene-root">
      <div className="scene-bar">
        <span className="brand" style={{ fontSize: "0.95rem" }}>
          Sunday<b>Stage</b>
        </span>
        <span className="scene-bar-right">
          {degraded && !ended ? (
            <span className="scene-badge">
              <span className="conn-dot off" style={{ position: "static" }} />
              {join === "offline" ? t("display.offline") : t("display.reconnecting")}
            </span>
          ) : null}
          <span className="scene-clock">{clock}</span>
        </span>
      </div>

      <div className="scene-now">
        {ended ? (
          <div className="state-quiet">
            <div className="display">{t("display.ended")}</div>
          </div>
        ) : showSlide ? (
          <>
            {frame.section_label ? <div className="scene-label">{frame.section_label}</div> : null}
            <div key={state.seq} className="scene-now-text slide-fade" aria-live="polite">
              {(frame.text_lines ?? []).map((line, i) => (
                <span key={i} style={{ display: "block" }}>
                  {line}
                </span>
              ))}
            </div>
            {frame.reference ? <div className="scene-ref">{frame.reference}</div> : null}
          </>
        ) : (
          <div className="state-quiet">
            <div className="display">{overlay ? t("scene.hold") : t("follow.waiting")}</div>
          </div>
        )}
      </div>

      <div className={`scene-next${hasNext ? "" : " scene-next--empty"}`}>
        <div className="scene-next-head">{t("scene.next")}</div>
        {hasNext && frame.next_lines ? (
          <div className="scene-next-text" aria-live="polite">
            {frame.next_label ? <span className="scene-next-label">{frame.next_label}</span> : null}
            {frame.next_lines.map((line, i) => (
              <span key={i} style={{ display: "block" }}>
                {line}
              </span>
            ))}
          </div>
        ) : (
          <div className="scene-next-empty">{t("scene.nextUnavailable")}</div>
        )}
      </div>
    </div>
  );
}

/** A wall clock (HH:MM), updated every 10 s. */
function useClock(): string {
  const [now, setNow] = useState("");
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      const d = new Date();
      setNow(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      );
    };
    void (async () => {
      await Promise.resolve();
      if (!cancelled) tick();
    })();
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return now;
}

/** Keep the stage monitor awake for the whole set (best-effort). */
function useWakeLock(): void {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(t: string): Promise<never> } })
          .wakeLock;
        if (wl) lock = (await wl.request("screen")) as unknown as { release(): Promise<void> };
      } catch {
        // best-effort (older browsers)
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
}
