import { describe, expect, it } from "vitest";
import { INITIAL_DISPLAY_STATE, applyEnvelope, applySnapshot } from "@/lib/merge";
import type { WebFrame } from "@/lib/webframe";

const frame = (n: number): WebFrame => ({ v: 1, kind: "message", message: `frame ${n}` });
const env = (seq: number) => ({ v: 1, seq, frame: frame(seq), emitted_at: "2026-06-13T00:00:00Z" });

describe("applyEnvelope", () => {
  it("applies strictly newer, ignores stale and duplicates", () => {
    let s = INITIAL_DISPLAY_STATE;
    s = applyEnvelope(s, env(1));
    s = applyEnvelope(s, env(3));
    expect(s.seq).toBe(3);
    const before = s;
    s = applyEnvelope(s, env(2)); // stale broadcast arriving late
    s = applyEnvelope(s, env(3)); // duplicate
    expect(s).toBe(before); // identity — no re-render churn
  });

  it("rejects garbage seq", () => {
    const s = applyEnvelope(INITIAL_DISPLAY_STATE, { ...env(1), seq: Number.NaN });
    expect(s.seq).toBe(0);
  });
});

describe("applySnapshot (polling through the same rule)", () => {
  it("catches a display up after missed broadcasts", () => {
    let s = applyEnvelope(INITIAL_DISPLAY_STATE, env(2));
    s = applySnapshot(s, { seq: 7, frame: frame(7), status: "live" });
    expect(s.seq).toBe(7);
    expect(s.frame?.message).toBe("frame 7");
  });

  it("a stale poll never regresses a fresher broadcast", () => {
    let s = applyEnvelope(INITIAL_DISPLAY_STATE, env(9));
    s = applySnapshot(s, { seq: 5, frame: frame(5), status: "live" });
    expect(s.seq).toBe(9);
    expect(s.frame?.message).toBe("frame 9");
  });

  it("ended is sticky — a stale live poll cannot resurrect a session", () => {
    let s = applySnapshot(INITIAL_DISPLAY_STATE, { seq: 1, frame: frame(1), status: "ended" });
    s = applySnapshot(s, { seq: 0, frame: null, status: "live" });
    expect(s.status).toBe("ended");
  });
});
