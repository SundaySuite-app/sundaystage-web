import { describe, expect, it } from "vitest";
import * as lib from "@/lib/commandSig";
import * as script from "../scripts/commandSig.mjs";

/**
 * scripts/smoke.mjs runs under bare `node` and cannot import the TypeScript
 * lib, so the command HMAC exists twice: lib/commandSig.ts (what the server
 * signs with, hand-rolled base64url over btoa) and scripts/commandSig.mjs
 * (what the smoke verifies with, Buffer's base64url). If they ever drift, the
 * smoke would fail against PRODUCTION for a reason that has nothing to do with
 * production. These tests pin the two to identical output so drift breaks
 * `npm run check` instead.
 *
 * The desktop verifier (`sundaystage/src/lib/webShare.ts`) is the third copy of
 * this payload format and lives outside this repo — the smoke is what covers it.
 */
const SECRET = "a".repeat(64);
const SESSION = "8f1c2c3d-0000-4000-8000-000000000001";

const CASES: [string, number][] = [
  ["next", 1],
  ["prev", 2],
  ["black", 1_754_600_000_001],
  ["logo", 0],
  ["clear", Number.MAX_SAFE_INTEGER],
];

describe("commandSig: lib and smoke-script implementations agree", () => {
  it("payload strings are identical", () => {
    for (const [cmd, seq] of CASES) {
      expect(script.commandSigPayload(SESSION, cmd, seq)).toBe(
        lib.commandSigPayload(SESSION, cmd, seq),
      );
    }
  });

  it("signatures are byte-identical (base64url encodings must not drift)", async () => {
    for (const [cmd, seq] of CASES) {
      const fromLib = await lib.signCommand(SECRET, SESSION, cmd, seq);
      const fromScript = await script.signCommand(SECRET, SESSION, cmd, seq);
      expect(fromScript).toBe(fromLib);
      // base64url: no +, /, or = padding — the desktop compares strings verbatim.
      expect(fromLib).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("each verifier accepts the other's signature and rejects a forgery", async () => {
    const sig = await lib.signCommand(SECRET, SESSION, "next", 7);
    expect(await script.verifyCommandSig(SECRET, SESSION, "next", 7, sig)).toBe(true);

    const scriptSig = await script.signCommand(SECRET, SESSION, "next", 7);
    expect(await lib.verifyCommandSig(SECRET, SESSION, "next", 7, scriptSig)).toBe(true);

    // A forged broadcast carries no secret — neither side may accept it.
    expect(await lib.verifyCommandSig(SECRET, SESSION, "black", 99, undefined)).toBe(false);
    expect(await script.verifyCommandSig(SECRET, SESSION, "black", 99, undefined)).toBe(false);
    // Right secret, wrong cmd_seq: the signature must not transfer.
    expect(await script.verifyCommandSig(SECRET, SESSION, "next", 8, sig)).toBe(false);
  });
});
