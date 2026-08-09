/**
 * Monotonic `cmd_seq` for the remote control (web operator → desktop app).
 *
 * The desktop consumer remembers the highest cmd_seq it has seen for a session
 * and DROPS anything `<=` it (replay/stale rejection). A 0-based counter held
 * in component state therefore breaks across remounts: reload the operator
 * phone mid-service and it restarts at 1, so the next N taps are accepted by
 * the API (200) and silently ignored by the desktop — remote control looks
 * dead with nothing in any log. Seeding from the wall clock instead means a
 * fresh mount resumes ABOVE everything the previous mount sent, because time
 * only moves forward.
 *
 * `Math.max(now(), last + 1)` keeps the sequence strictly increasing even when
 * several taps land inside the same millisecond (or the clock steps backwards
 * mid-mount, e.g. an NTP correction).
 *
 * Residual limitations, accepted deliberately:
 *  - Two operators on DIFFERENT devices with skewed clocks still collide: the
 *    laggier device's commands are dropped until its clock passes the other's.
 *  - A burst that borrows values from the future (n taps in one millisecond
 *    lands n-1 ms ahead) followed by an immediate remount can repeat a value.
 * The real fix is a SERVER-assigned cmd_seq — the same atomic-RPC treatment the
 * frame `seq` already gets — which needs a migration on the shared Supabase
 * project and is therefore owner-gated. Tracked as a follow-up.
 */

/** Create a per-mount generator. Each call returns a strictly larger number. */
export function createCmdSeq(now: () => number = Date.now): () => number {
  let last = 0;
  return () => {
    last = Math.max(Math.trunc(now()), last + 1);
    return last;
  };
}
