/**
 * Exponential backoff for the reconnect poll.
 *
 * The display's polling safety net runs fast (3 s) while the realtime socket is
 * down but the server is still reachable — that is the net doing its job. But
 * during an EXTENDED outage (server unreachable, every poll failing) a flat 3 s
 * hammer is wasteful; it should back off. So backoff is driven by consecutive
 * POLL FAILURES, not by the socket state: polls that keep succeeding while the
 * socket is down stay fast (3 s), polls that keep failing grow 3→6→12→…→60 s,
 * and the first success snaps back to the fast base. The healthy-path 15 s poll
 * (socket up) is a separate, unchanged cadence.
 *
 * Hand-rolled rather than a dependency: this is ~2 lines of arithmetic, stays a
 * pure function testable in the node env (like lib/merge.ts), and keeps the
 * Cloudflare Worker bundle free of a transitive dep for something this small.
 */

/** Fast base — the first reconnect attempt, and where a success resets to. */
export const BACKOFF_MIN_MS = 3_000;
/** Ceiling — an extended outage never polls slower than this. */
export const BACKOFF_MAX_MS = 60_000;

/**
 * Delay before the next reconnect poll after `failures` consecutive failures.
 * failures 0 → 3 s (first retry / post-success), 1 → 6 s, 2 → 12 s, 3 → 24 s,
 * 4 → 48 s, 5+ → 60 s (capped). Doubling with a hard cap.
 */
export function backoffDelay(
  failures: number,
  min = BACKOFF_MIN_MS,
  max = BACKOFF_MAX_MS,
): number {
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0;
  const delay = min * 2 ** n;
  return Number.isFinite(delay) && delay < max ? delay : max;
}

/**
 * Fold a poll outcome into the consecutive-failure count: a success resets to
 * 0 (fast again), a failure increments (slower next time). Pairing this with
 * `backoffDelay` gives the whole progression + reset-on-success behaviour.
 */
export function foldOutcome(failures: number, ok: boolean): number {
  if (ok) return 0;
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0;
  return n + 1;
}
