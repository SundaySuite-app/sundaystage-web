/**
 * Sequence-merge reducer — broadcast hints and polling results flow through
 * the SAME rule, so a stale packet can never overwrite a fresher frame
 * (the sundaysjakk "merge by ply" discipline).
 */
import type { FrameEnvelope, WebFrame } from "./webframe";

export interface DisplayState {
  seq: number;
  frame: WebFrame | null;
  status: "live" | "ended";
}

export const INITIAL_DISPLAY_STATE: DisplayState = { seq: 0, frame: null, status: "live" };

/** Apply an incoming envelope iff it is strictly newer. */
export function applyEnvelope(state: DisplayState, env: FrameEnvelope): DisplayState {
  if (!Number.isFinite(env.seq) || env.seq <= state.seq) return state;
  return { ...state, seq: env.seq, frame: env.frame };
}

/** Apply a polled state snapshot (same newer-wins rule + status). */
export function applySnapshot(
  state: DisplayState,
  snap: { seq: number; frame: WebFrame | null; status: "live" | "ended" },
): DisplayState {
  const next = snap.seq > state.seq ? { seq: snap.seq, frame: snap.frame } : {};
  // Status only moves forward (live → ended), never backwards.
  const status = state.status === "ended" || snap.status === "ended" ? "ended" : "live";
  return { ...state, ...next, status };
}
