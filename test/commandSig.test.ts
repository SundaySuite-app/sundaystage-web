import { describe, expect, it } from "vitest";
import { commandSigPayload, signCommand, verifyCommandSig } from "@/lib/commandSig";

const SECRET = "a".repeat(64);
const ID = "0197f9a0-0000-7000-8000-000000000001";

describe("command signing", () => {
  it("builds the payload string the desktop mirrors", () => {
    expect(commandSigPayload(ID, "next", 7)).toBe(`${ID}:next:7`);
  });

  it("signs deterministically and verifies round-trip", async () => {
    const sig = await signCommand(SECRET, ID, "next", 1);
    expect(sig).toBe(await signCommand(SECRET, ID, "next", 1));
    // base64url: no padding, no +/ characters
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await verifyCommandSig(SECRET, ID, "next", 1, sig)).toBe(true);
  });

  it("rejects a signature under a different secret (the forged-broadcast case)", async () => {
    const forged = await signCommand("b".repeat(64), ID, "next", 1);
    expect(await verifyCommandSig(SECRET, ID, "next", 1, forged)).toBe(false);
  });

  it("rejects when any signed field is tampered with", async () => {
    const sig = await signCommand(SECRET, ID, "next", 1);
    expect(await verifyCommandSig(SECRET, ID, "prev", 1, sig)).toBe(false);
    expect(await verifyCommandSig(SECRET, ID, "next", 2, sig)).toBe(false);
    expect(await verifyCommandSig(SECRET, "other-session", "next", 1, sig)).toBe(false);
  });

  it("rejects a missing signature (old/unsigned broadcasts are not trusted)", async () => {
    expect(await verifyCommandSig(SECRET, ID, "next", 1, undefined)).toBe(false);
    expect(await verifyCommandSig(SECRET, ID, "next", 1, "")).toBe(false);
  });
});
