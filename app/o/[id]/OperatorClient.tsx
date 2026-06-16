"use client";

/**
 * The operator console. Two jobs:
 *  - WEB sessions: paste lyrics → slides, tap to show, next/prev/black/logo —
 *    every action computes a WebFrame client-side and POSTs the shared /frame
 *    endpoint (same write path as the desktop forwarder). Slides can be edited,
 *    reordered and deleted; a setlist can be saved as a reusable template.
 *  - DESKTOP sessions: the slide grid is hidden; the transport buttons become
 *    a REMOTE CONTROL that broadcasts commands the desktop app acts on.
 * Keyboard: Space/→ next, ← prev, B black, L logo (ignored while typing).
 * The session secret lives in localStorage from /new (or via the desktop deep
 * link `/o/<id>#s=<secret>` which we persist and scrub from the URL).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { pasteToSlides, sectionsToSlides, type SlideDef } from "@/lib/sections";
import { moveSlide, removeSlideAt, updateSlideAt, reindexCurrent } from "@/lib/setlist";
import {
  loadTemplates,
  saveTemplates,
  upsertTemplate,
  removeTemplate,
  type Template,
} from "@/lib/templates";
import { WEBFRAME_VERSION, type WebFrame } from "@/lib/webframe";
import { usePresence } from "@/lib/client/usePresence";
import { SlideRenderer } from "@/components/SlideRenderer";
import { LibraryPicker } from "@/components/LibraryPicker";
import { t } from "@/lib/locale/i18n";
import type { RemoteCommand } from "@/lib/realtime";
import type { LibrarySong } from "@/lib/client/useLibrary";

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
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [qr, setQr] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewers = usePresence(id, { viewerId, role: "operator" });
  const displayCount = viewers.filter((v) => v.role === "display").length;
  const followCount = viewers.filter((v) => v.role === "follow").length;
  const sceneCount = viewers.filter((v) => v.role === "scene").length;

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

  // Load saved templates from this device.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) setTemplates(loadTemplates());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const auth = useMemo(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${stored?.secret ?? ""}` }),
    [stored?.secret],
  );

  const host = typeof window !== "undefined" ? window.location.host : "stage.sundaysuite.app";

  // Build a QR for the display join URL so the room can scan instead of type.
  useEffect(() => {
    const code = stored?.code;
    if (!code) return;
    let cancelled = false;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(`https://${host}/d/${code}`, {
          margin: 1,
          width: 360,
        });
        if (!cancelled) setQr(dataUrl);
      } catch {
        // QR is a nicety — ignore failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stored?.code, host]);

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

  const frameForSlide = (index: number, arr: SlideDef[] = slides): WebFrame => {
    const s = arr[index];
    const next = arr[index + 1];
    return {
      v: WEBFRAME_VERSION,
      kind: "slide",
      text_lines: s.lines,
      section_label: s.label ?? undefined,
      // Power the scene/confidence monitor with the upcoming slide.
      next_lines: next?.lines,
      next_label: next?.label ?? undefined,
    };
  };

  function showSlide(index: number) {
    if (index < 0 || index >= slides.length) return;
    setCurrent(index);
    setOverlay("none");
    void postFrame(frameForSlide(index));
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
      if (current >= 0) void postFrame(frameForSlide(current));
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
    // The live slide may have gained a "next" — refresh the scene monitor.
    if (current >= 0 && overlay === "none") void postFrame(frameForSlide(current, next));
  }

  // Append a song chosen from the church library, through the SAME slide flow as
  // paste (sectionsToSlides keeps the slide shape identical).
  function addSongToSetlist(song: LibrarySong) {
    const parsed = sectionsToSlides(
      song.sections.map((s) => ({ label: s.label ?? null, lines: s.lines })),
    );
    if (parsed.length === 0) return;
    const next = [...slides, ...parsed];
    setSlides(next);
    saveSetlist(next, current);
    if (current >= 0 && overlay === "none") void postFrame(frameForSlide(current, next));
  }

  // ── Slide editing / reordering ────────────────────────────────────────────

  function startEdit(i: number) {
    setEditing(i);
    setEditText(slides[i].lines.join("\n"));
  }

  function saveEdit(i: number) {
    const lines = editText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      setEditing(null);
      return;
    }
    const next = updateSlideAt(slides, i, { lines });
    setSlides(next);
    setEditing(null);
    saveSetlist(next, current);
    if (i === current && overlay === "none") void postFrame(frameForSlide(i, next));
  }

  function doMove(from: number, to: number) {
    const next = moveSlide(slides, from, to);
    if (next === slides) return;
    const nextCurrent = reindexCurrent(current, { type: "move", from, to }, slides.length);
    setSlides(next);
    setCurrent(nextCurrent);
    saveSetlist(next, nextCurrent);
    if (nextCurrent >= 0 && overlay === "none") void postFrame(frameForSlide(nextCurrent, next));
  }

  function doRemove(i: number) {
    const next = removeSlideAt(slides, i);
    if (next === slides) return;
    const wasShowingRemoved = i === current && overlay === "none";
    const nextCurrent = reindexCurrent(current, { type: "remove", index: i }, slides.length);
    setSlides(next);
    setCurrent(nextCurrent);
    if (editing === i) setEditing(null);
    saveSetlist(next, nextCurrent);
    // Refresh the live slide's next-preview, but don't yank the projector onto a
    // different slide just because an earlier one was deleted.
    if (!wasShowingRemoved && nextCurrent >= 0 && overlay === "none") {
      void postFrame(frameForSlide(nextCurrent, next));
    }
  }

  function clearAll() {
    setSlides([]);
    setCurrent(-1);
    setEditing(null);
    saveSetlist([], -1);
  }

  // ── Templates (per-device, localStorage) ──────────────────────────────────

  function saveAsTemplate() {
    if (slides.length === 0) return;
    const name = window.prompt(t("op.templateNamePrompt"))?.trim();
    if (!name) return;
    const next = upsertTemplate(templates, { name, slides, savedAt: Date.now() });
    setTemplates(next);
    if (!saveTemplates(next)) window.alert(t("op.templateQuota"));
  }

  function loadTemplate(tp: Template) {
    setSlides(tp.slides);
    setCurrent(-1);
    setOverlay("none");
    setEditing(null);
    saveSetlist(tp.slides, -1);
  }

  function deleteTemplate(name: string) {
    const next = removeTemplate(templates, name);
    setTemplates(next);
    saveTemplates(next);
  }

  async function endSession() {
    if (!window.confirm(t("op.endConfirm"))) return;
    await fetch(`/api/sessions/${id}/end`, { method: "POST", headers: auth });
    setLost(true);
  }

  // Briefly surface a confirmation message (e.g. after copying the PIN).
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  async function copyPin() {
    const code = stored?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast(t("op.pinCopied"));
    } catch {
      // Clipboard blocked (insecure context / permission) — no-op, the code is
      // still shown on screen for manual entry.
    }
  }

  // ── Keyboard transport (Space/arrows/B/L), ignored while typing ───────────
  // A ref kept current every render delegates from one stable listener, so the
  // hotkeys always see the latest state without re-subscribing.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKeyRef.current = (e: KeyboardEvent) => {
      if (lost) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        toggleOverlay("black");
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        toggleOverlay("logo");
      }
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
          <div
            style={{
              display: "flex",
              gap: "0.4rem",
              justifyContent: "center",
              marginTop: "0.3rem",
            }}
          >
            <button
              className="btn btn--ghost op-mini2"
              disabled={!stored?.code}
              onClick={() => void copyPin()}
            >
              {t("op.copyPin")}
            </button>
            <button
              className="btn btn--ghost op-mini2"
              disabled={!stored?.code}
              onClick={() => setShowQr(true)}
            >
              {t("op.qr")}
            </button>
          </div>
        </div>
        <div className="op-meta">
          {t("op.displays", { n: displayCount })} · {t("op.followers", { n: followCount })} ·{" "}
          {t("op.musicians", { n: sceneCount })}
          {mode === "desktop" ? <> · {t("op.remote")}</> : null}
          <button
            className="btn btn--ghost"
            style={{ marginLeft: "0.8rem" }}
            onClick={() => void endSession()}
          >
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
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
              <button className="btn btn--gold" disabled={!paste.trim()} onClick={addSlides}>
                {t("op.addSlides")}
              </button>
              {slides.length > 0 ? (
                <button className="btn btn--ghost" onClick={clearAll}>
                  {t("op.clear")}
                </button>
              ) : null}
            </div>

            <div className="op-templates">
              <button
                className="btn btn--ghost op-mini2"
                disabled={slides.length === 0}
                onClick={saveAsTemplate}
              >
                {t("op.saveTemplate")}
              </button>
              {templates.length > 0 ? (
                <details className="op-templates-list">
                  <summary className="btn btn--ghost op-mini2">
                    {t("op.templates", { n: templates.length })}
                  </summary>
                  <div className="op-templates-menu">
                    {templates.map((tp) => (
                      <div key={tp.name} className="op-template-row">
                        <button className="op-template-load" onClick={() => loadTemplate(tp)}>
                          {tp.name}
                        </button>
                        <button
                          className="op-mini"
                          title={t("op.delete")}
                          onClick={() => deleteTemplate(tp.name)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <LibraryPicker onPick={addSongToSetlist} />
            </div>
          </div>

          {slides.length === 0 ? (
            <p className="muted" style={{ padding: "1.4rem 0" }}>
              {t("op.empty")}
            </p>
          ) : (
            <div className="op-grid">
              {slides.map((s, i) => (
                <div
                  key={i}
                  className={`op-slide${i === current && overlay === "none" ? " active" : ""}`}
                >
                  {editing === i ? (
                    <div className="op-slide-edit">
                      <textarea
                        className="op-edit-area"
                        value={editText}
                        autoFocus
                        onChange={(e) => setEditText(e.target.value)}
                      />
                      <div className="op-slide-actions">
                        <button className="btn btn--gold op-mini2" onClick={() => saveEdit(i)}>
                          {t("op.save")}
                        </button>
                        <button
                          className="btn btn--ghost op-mini2"
                          onClick={() => setEditing(null)}
                        >
                          {t("op.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className="op-slide-main" onClick={() => showSlide(i)}>
                        {s.label ? <span className="lbl">{s.label}</span> : null}
                        {s.lines.slice(0, 4).map((l, j) => (
                          <span key={j} style={{ display: "block" }}>
                            {l}
                          </span>
                        ))}
                      </button>
                      <div className="op-slide-actions">
                        <button
                          className="op-mini"
                          title={t("op.moveUp")}
                          disabled={i === 0}
                          onClick={() => doMove(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          className="op-mini"
                          title={t("op.moveDown")}
                          disabled={i === slides.length - 1}
                          onClick={() => doMove(i, i + 1)}
                        >
                          ↓
                        </button>
                        <button className="op-mini" title={t("op.edit")} onClick={() => startEdit(i)}>
                          ✎
                        </button>
                        <button
                          className="op-mini"
                          title={t("op.delete")}
                          onClick={() => doRemove(i)}
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {current >= 0 && overlay === "none" ? (
            <div
              style={{
                position: "fixed",
                right: "1rem",
                bottom: "5.6rem",
                width: "13rem",
                aspectRatio: "16/9",
                borderRadius: "10px",
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              <SlideRenderer frame={frameForSlide(current)} animateKey={current} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: "grid", placeItems: "center" }}>
          <p className="muted" style={{ maxWidth: "26rem", textAlign: "center" }}>
            {t("op.remote")}
          </p>
        </div>
      )}

      <div className="op-controls">
        <button className="btn" onClick={() => toggleOverlay("black")}>
          {t("op.black")}
        </button>
        <button
          className="btn btn--lg"
          onClick={() => step(-1)}
          disabled={mode === "web" && current <= 0}
        >
          ← {t("op.prev")}
        </button>
        <button
          className="btn btn--gold btn--lg op-next"
          onClick={() => step(1)}
          disabled={mode === "web" && current >= slides.length - 1}
        >
          {t("op.next")} →
        </button>
        <button className="btn" onClick={() => toggleOverlay("logo")}>
          {t("op.logo")}
        </button>
      </div>

      {showQr ? (
        <div className="op-qr-overlay" onClick={() => setShowQr(false)}>
          <div className="op-qr-card" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t("op.qrTitle")}</div>
            {qr ? (
              <div
                className="op-qr-img"
                role="img"
                aria-label="QR"
                style={{ backgroundImage: `url(${qr})` }}
              />
            ) : (
              <p className="muted">…</p>
            )}
            <div className="op-qr-code">{stored?.code}</div>
            <div className="muted">
              {host}/d/{stored?.code}
            </div>
            <button className="btn btn--ghost" onClick={() => setShowQr(false)}>
              {t("op.qrClose")}
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="op-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
