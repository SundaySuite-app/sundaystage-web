"use client";

import { useEffect } from "react";

/** Slår fullskjerm av/på. Må kalles fra en brukerbevegelse (klikk/tastetrykk). */
export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/** F = fullskjerm av/på. Ignoreres i tekstfelt og med modifikatortaster. */
export function useFullscreenKey(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
