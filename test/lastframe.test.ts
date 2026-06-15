import { describe, expect, it } from "vitest";
import { classifyJoinStatus, parseLast, lastKey, LAST_PREFIX } from "@/lib/client/lastframe";

describe("classifyJoinStatus", () => {
  it("treats 404 as not_found and everything else as offline", () => {
    expect(classifyJoinStatus(404)).toBe("not_found");
    expect(classifyJoinStatus(500)).toBe("offline");
    expect(classifyJoinStatus(0)).toBe("offline");
    expect(classifyJoinStatus(503)).toBe("offline");
  });
});

describe("lastKey", () => {
  it("namespaces by code", () => {
    expect(lastKey("123456")).toBe(`${LAST_PREFIX}123456`);
  });
});

describe("parseLast", () => {
  const now = 1_000_000_000_000;
  const valid = JSON.stringify({
    seq: 5,
    frame: { v: 1, kind: "message", message: "hi" },
    status: "live",
    savedAt: now,
  });

  it("parses a fresh entry", () => {
    const s = parseLast(valid, now + 1000);
    expect(s?.seq).toBe(5);
    expect(s?.frame?.message).toBe("hi");
  });
  it("rejects null / garbage / bad seq", () => {
    expect(parseLast(null, now)).toBeNull();
    expect(parseLast("{bad", now)).toBeNull();
    expect(parseLast(JSON.stringify({ seq: "x", status: "live", savedAt: now }), now)).toBeNull();
  });
  it("rejects an entry past the 24 h TTL", () => {
    const old = JSON.stringify({ seq: 1, frame: null, status: "live", savedAt: now });
    expect(parseLast(old, now + 25 * 60 * 60 * 1000)).toBeNull();
  });
  it("rejects a bad status", () => {
    const bad = JSON.stringify({ seq: 1, frame: null, status: "weird", savedAt: now });
    expect(parseLast(bad, now)).toBeNull();
  });
});
