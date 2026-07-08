/**
 * HMAC signing for remote-control commands (web operator → desktop).
 *
 * The commands channel is reachable by anyone holding the public anon key and
 * the session UUID (which the unauthenticated by-code join hands out), so the
 * broadcast itself cannot be trusted. Instead the server signs every command
 * with the session's bearer secret — which only the operator (who created the
 * session or was deep-linked it) can present — and the desktop recomputes the
 * HMAC with its own copy of the secret before dispatching. A forged client
 * broadcast can never carry a valid signature.
 *
 * Mirrored by `sundaystage/src/lib/webShare.ts` (verify side) — keep the
 * payload string format in sync.
 */

export function commandSigPayload(sessionId: string, cmd: string, cmdSeq: number): string {
  return `${sessionId}:${cmd}:${cmdSeq}`;
}

export async function signCommand(
  secret: string,
  sessionId: string,
  cmd: string,
  cmdSeq: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(commandSigPayload(sessionId, cmd, cmdSeq)),
  );
  return base64url(new Uint8Array(sig));
}

export async function verifyCommandSig(
  secret: string,
  sessionId: string,
  cmd: string,
  cmdSeq: number,
  sig: string | undefined,
): Promise<boolean> {
  if (!sig) return false;
  return (await signCommand(secret, sessionId, cmd, cmdSeq)) === sig;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
