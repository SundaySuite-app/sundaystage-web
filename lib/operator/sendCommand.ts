/**
 * The web operator's remote-control write path (desktop-driven sessions).
 *
 * A transport tap POSTs the bare command to /api/sessions/<id>/command; the
 * server assigns the authoritative `cmd_seq`, signs `cmd + cmd_seq` with the
 * session secret and broadcasts it. The client deliberately sends NO sequence
 * number: the desktop drops any cmd_seq <= the highest it has seen for the
 * session, and a client-held counter cannot survive an operator reload or a
 * second operator device (that was the clock-seeded stopgap this replaces).
 * The assigned seq comes back in the response and is of no use here — nothing
 * client-side orders against it.
 *
 * This module is the (testable) seam between the console and the network; the
 * component only calls `send(cmd)`. Mirrors createFrameSender.
 */
import type { RemoteCommand } from "@/lib/realtime";

interface CommandSenderOptions {
  /** The session this operator drives (stable for the page's lifetime). */
  sessionId: string;
  /**
   * Request headers, read FRESH on every send: the session secret resolves
   * asynchronously (localStorage or the desktop deep-link fragment), so a
   * sender built at mount would otherwise be pinned to an empty bearer.
   */
  headers: () => HeadersInit;
}

export function createCommandSender(
  opts: CommandSenderOptions,
): (cmd: RemoteCommand) => Promise<void> {
  return async (cmd) => {
    await fetch(`/api/sessions/${opts.sessionId}/command`, {
      method: "POST",
      headers: opts.headers(),
      body: JSON.stringify({ cmd }),
    });
  };
}
