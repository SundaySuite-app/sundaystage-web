// Realtime channel + event names. Shared by client (subscribe) and server
// (broadcast). Channels are keyed by the session UUID — never the guessable
// 6-digit PIN, which only resolves to an id at join time. Broadcast payloads
// carry the authoritative frame (server-stamped seq); polling through the
// same merge reducer is the safety net, so a lost broadcast can never wedge a
// display.

export const channels = {
  /** Frames + lifecycle for one live session. */
  session: (sessionId: string) => `stage:session:${sessionId}`,
  /** Remote-control commands (web operator → desktop app). */
  commands: (sessionId: string) => `stage:session:${sessionId}:commands`,
} as const;

export const events = {
  /** A new frame is live: payload { v, seq, frame, emitted_at }. */
  frame: "frame",
  /** Session lifecycle: payload { status: "live" | "ended" }. */
  session: "session",
  /** Remote-control command: payload { cmd, cmd_seq } (commands channel). */
  command: "command",
} as const;

/** Commands the desktop app accepts from a web operator. */
export const REMOTE_COMMANDS = ["next", "prev", "black", "logo", "clear"] as const;
export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];
