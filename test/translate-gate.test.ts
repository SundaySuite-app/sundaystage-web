import { describe, expect, it } from "vitest";
import { evaluateTranslateGate, type SessionLike } from "@/lib/translate/gate";
import { WEBFRAME_VERSION, SENSITIVE_PLACEHOLDER, type WebFrame } from "@/lib/webframe";

const live: SessionLike = { status: "live" };
const ended: SessionLike = { status: "ended" };

const slide = (text_lines: string[], extra: Partial<WebFrame> = {}): WebFrame => ({
  v: WEBFRAME_VERSION,
  kind: "slide",
  text_lines,
  ...extra,
});

describe("evaluateTranslateGate", () => {
  it("404 fails when the session does not resolve", () => {
    expect(evaluateTranslateGate(null, slide(["Hallo"]))).toEqual({
      decision: "fail",
      status: 404,
      error: "not_found",
    });
  });

  it("410 fails on an ENDED session (don't burn quota after the service)", () => {
    expect(evaluateTranslateGate(ended, slide(["Hallo"]))).toEqual({
      decision: "fail",
      status: 410,
      error: "session_ended",
    });
  });

  it("proceeds for a fresh, translatable slide on a live session", () => {
    expect(evaluateTranslateGate(live, slide(["Stor er din trofasthet"]))).toEqual({
      decision: "proceed",
    });
  });

  it("skips non-slide frames as not_translatable", () => {
    const black: WebFrame = { v: WEBFRAME_VERSION, kind: "black" };
    expect(evaluateTranslateGate(live, black)).toEqual({
      decision: "skip",
      source: "not_translatable",
    });
  });

  it("skips slides with no text lines", () => {
    expect(evaluateTranslateGate(live, slide([]))).toEqual({
      decision: "skip",
      source: "not_translatable",
    });
  });

  it("NEVER translates gated content (placeholder text)", () => {
    expect(evaluateTranslateGate(live, slide([SENSITIVE_PLACEHOLDER]))).toEqual({
      decision: "skip",
      source: "not_translatable",
    });
  });

  it("passes through when the frame already carries a translation", () => {
    const f = slide(["Hallo"], { translation_lines: ["Hello"] });
    expect(evaluateTranslateGate(live, f)).toEqual({
      decision: "skip",
      source: "passthrough",
    });
  });

  it("does NOT pass through on an empty translation array (still needs work)", () => {
    const f = slide(["Hallo"], { translation_lines: [] });
    expect(evaluateTranslateGate(live, f)).toEqual({ decision: "proceed" });
  });

  it("checks liveness BEFORE translatability (ended slide → 410, not skip)", () => {
    expect(evaluateTranslateGate(ended, slide([]))).toEqual({
      decision: "fail",
      status: 410,
      error: "session_ended",
    });
  });
});
