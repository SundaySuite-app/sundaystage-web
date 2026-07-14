// Realtime channel + event names. Shared by client (subscribe) and server
// (broadcast). Channels are keyed by the session UUID — never the guessable
// 6-digit PIN, which only resolves to an id at join time. Broadcast payloads
// carry the authoritative frame (server-stamped seq); polling through the
// same merge reducer is the safety net, so a lost broadcast can never wedge a
// display.

export const channels = {
  /** Frames + lifecycle for one live session. PRIVATE channel — subscribers
   *  join with `config.private` and the server sends with `{ private: true }`
   *  (RLS on realtime.messages denies forged anon frames). */
  session: (sessionId: string) => `stage:session:${sessionId}`,
  /** Remote-control commands (web operator → desktop app). PRIVATE channel:
   *  the desktop subscriber joins with `config.private` so a forged anon
   *  `.send()` command is denied. The server dual-sends (public + private)
   *  while old desktop builds still listen on the public topic. */
  commands: (sessionId: string) => `stage:session:${sessionId}:commands`,
} as const;

export const events = {
  /** A new frame is live: payload { v, seq, frame, emitted_at }. */
  frame: "frame",
  /** Session lifecycle: payload { status: "live" | "ended" }. */
  session: "session",
  /** Remote-control command: payload is a CommandPayload (commands channel). */
  command: "command",
} as const;

/** Commands the desktop app accepts from a web operator. */
export const REMOTE_COMMANDS = ["next", "prev", "black", "logo", "clear"] as const;
export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];

/**
 * What the server broadcasts on the commands channel. `sig` is
 * base64url(HMAC-SHA256(session secret, `${sessionId}:${cmd}:${cmd_seq}`)) —
 * see lib/commandSig.ts. The desktop drops any command whose signature does
 * not verify, so a forged client broadcast on the channel is inert.
 */
export interface CommandPayload {
  cmd: RemoteCommand;
  cmd_seq: number;
  sig: string;
}
