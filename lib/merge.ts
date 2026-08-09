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

/**
 * Base state for the JOIN snapshot, given what (if anything) was rehydrated
 * from localStorage before the join resolved.
 *
 * Newer-wins is the right rule inside one session and the wrong one across
 * two: join PINs are unique only among LIVE sessions, so the same code is
 * handed out again once a service ends. A rehydrated `seq 50` from this
 * morning's service outranks the new session's snapshot `seq 1` and every
 * broadcast until it climbs past 50 — the display sticks on the previous
 * service's last slide with no way to self-heal. So a cache entry that cannot
 * be PROVEN to belong to the joined session is discarded outright.
 *
 * `cachedSessionId === undefined` means nothing was rehydrated, or an earlier
 * join already validated it — keep the live state. `null` is a legacy entry
 * with no id recorded: unprovable, therefore discarded.
 */
export function joinBase(
  state: DisplayState,
  joinedSessionId: string,
  cachedSessionId?: string | null,
): DisplayState {
  if (cachedSessionId === undefined) return state;
  return cachedSessionId === joinedSessionId ? state : INITIAL_DISPLAY_STATE;
}
