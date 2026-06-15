/**
 * Last-frame persistence for network displays. We stash the most recent slide
 * in localStorage keyed by the join code so a reload DURING a network outage
 * shows the last slide instead of a blank screen. Entries carry a timestamp and
 * expire with the session (24 h). Pure parse + classify, plus a thin,
 * never-throwing I/O layer (Safari private mode = quota 0).
 */
import type { DisplayState } from "@/lib/merge";
import type { WebFrame } from "@/lib/webframe";

export const LAST_PREFIX = "stage-last:";
const TTL_MS = 24 * 60 * 60 * 1000; // matches the server's 24 h session expiry

interface StoredLast {
  seq: number;
  frame: WebFrame | null;
  status: "live" | "ended";
  savedAt: number;
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
    if (d.status !== "live" && d.status !== "ended") return null;
    if (typeof d.savedAt !== "number" || now - d.savedAt > TTL_MS) return null;
    return {
      seq: d.seq,
      frame: (d.frame as WebFrame | null) ?? null,
      status: d.status,
      savedAt: d.savedAt,
    };
  } catch {
    return null;
  }
}

// ── Thin localStorage I/O (never throws) ────────────────────────────────────

export function loadLastState(code: string, now: number): DisplayState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const s = parseLast(localStorage.getItem(lastKey(code)), now);
    return s ? { seq: s.seq, frame: s.frame, status: s.status } : null;
  } catch {
    return null;
  }
}

export function saveLastState(code: string, state: DisplayState, now: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: StoredLast = {
      seq: state.seq,
      frame: state.frame,
      status: state.status,
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
