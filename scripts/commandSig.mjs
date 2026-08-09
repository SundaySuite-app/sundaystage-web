/**
 * Plain-Node mirror of lib/commandSig.ts.
 *
 * scripts/smoke.mjs runs under bare `node` against a deployed server, so it
 * cannot import the TypeScript lib — but it MUST compute byte-identical
 * signatures, or the smoke's "server command signature verifies" check would
 * fail for a reason that has nothing to do with the server.
 *
 * The two implementations are pinned together by test/commandSig-parity.test.ts,
 * so drift breaks `npm run check` instead of surfacing days later as a
 * mysterious red smoke run against production. Keep this file dependency-free
 * (WebCrypto + Buffer only) so `node scripts/smoke.mjs` needs no install.
 */

/** MUST match commandSigPayload() in lib/commandSig.ts. */
export function commandSigPayload(sessionId, cmd, cmdSeq) {
  return `${sessionId}:${cmd}:${cmdSeq}`;
}

/** MUST match signCommand() in lib/commandSig.ts (HMAC-SHA256, base64url). */
export async function signCommand(secret, sessionId, cmd, cmdSeq) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(commandSigPayload(sessionId, cmd, cmdSeq)),
  );
  return Buffer.from(mac).toString("base64url");
}

/** MUST match verifyCommandSig() in lib/commandSig.ts. */
export async function verifyCommandSig(secret, sessionId, cmd, cmdSeq, sig) {
  if (!sig) return false;
  return (await signCommand(secret, sessionId, cmd, cmdSeq)) === sig;
}
