/**
 * Last-frame persistence for network displays. We stash the most recent slide
 * in localStorage keyed by the join code so a reload DURING a network outage
 * shows the last slide instead of a blank screen. Entries carry a timestamp and
 * expire with the session (24 h). Pure parse + classify, plus a thin,
 * never-throwing I/O layer (Safari private mode = quota 0).
 *
 * Two rules keep a RECYCLED PIN from wedging a display on the previous
 * service's last slide (PINs are unique only among LIVE sessions, so the same
 * code comes back around the same day):
 *  1. Every entry carries the session id it belongs to. The caller compares it
 *     with the id the by-code join returns and throws the cache away on a
 *     mismatch — a stale seq 50 must never outrank the new session's seq 1.
 *  2. Lifecycle is NOT cached. We restore the frame for an instant repaint, but
 *     the server alone decides live vs ended; a persisted "ended" would be
 *     sticky in the merge reducer and no poll could ever clear it.
 */
import type { DisplayState } from "@/lib/merge";
import type { WebFrame } from "@/lib/webframe";

export const LAST_PREFIX = "stage-last:";
const TTL_MS = 24 * 60 * 60 * 1000; // matches the server's 24 h session expiry

interface StoredLast {
  /** Session this frame belongs to. `null` = legacy entry written before the
   *  field existed; treated as "cannot prove it's ours" and discarded at join. */
  sessionId: string | null;
  seq: number;
  frame: WebFrame | null;
  savedAt: number;
}

/** What a rehydrate hands back: paint this, then let the join validate it. */
interface RehydratedLast {
  sessionId: string | null;
  state: DisplayState;
}

export function lastKey(code: string): string {
  return `${LAST_PREFIX}${code}`;
}

/** A real 404 means the code is wrong/expired; everything else is transient. */
export function classifyJoinStatus(httpStatus: number): "not_found" | "offline" {
  return httpStatus === 404 ? "not_found" : "offline";
}

/** Parse a stored last-frame, honouring the TTL. Pure + defensive. */
export function parseLast(raw: string | null, now: number): StoredLast | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<StoredLast>;
    if (typeof d.seq !== "number" || !Number.isFinite(d.seq)) return null;
    if (typeof d.savedAt !== "number" || now - d.savedAt > TTL_MS) return null;
    return {
      sessionId: typeof d.sessionId === "string" ? d.sessionId : null,
      seq: d.seq,
      frame: (d.frame as WebFrame | null) ?? null,
      savedAt: d.savedAt,
    };
  } catch {
    return null;
  }
}

// ── Thin localStorage I/O (never throws) ────────────────────────────────────

/**
 * Rehydrate the last slide seen for this code. `status` is always "live": the
 * cache is a paint hint, never a lifecycle claim (see rule 2 above).
 */
export function loadLastState(code: string, now: number): RehydratedLast | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const s = parseLast(localStorage.getItem(lastKey(code)), now);
    if (!s) return null;
    return {
      sessionId: s.sessionId,
      state: { seq: s.seq, frame: s.frame, status: "live" },
    };
  } catch {
    return null;
  }
}

export function saveLastState(
  code: string,
  sessionId: string,
  state: DisplayState,
  now: number,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: StoredLast = {
      sessionId,
      seq: state.seq,
      frame: state.frame,
      savedAt: now,
    };
    localStorage.setItem(lastKey(code), JSON.stringify(payload));
    pruneExpired(now);
  } catch {
    // Quota (Safari private mode = 0) or unavailable — never break the display.
  }
}

/** Drop expired stage-last:* entries so the store can't grow without bound. */
function pruneExpired(now: number): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LAST_PREFIX)) continue;
      if (!parseLast(localStorage.getItem(key), now)) stale.push(key);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
