import { describe, expect, it } from "vitest";
import { sanitizeNext, ALLOWED_NEXT } from "@/lib/server/authNext";

describe("sanitizeNext (OAuth callback redirect whitelist)", () => {
  it("honours the two whitelisted destinations verbatim", () => {
    expect(sanitizeNext("/library")).toBe("/library");
    expect(sanitizeNext("/")).toBe("/");
    expect(ALLOWED_NEXT).toEqual(["/library", "/"]);
  });

  it("falls back to /library for missing input", () => {
    expect(sanitizeNext(null)).toBe("/library");
    expect(sanitizeNext(undefined)).toBe("/library");
    expect(sanitizeNext("")).toBe("/library");
  });

  it("rejects any in-app path that is not whitelisted", () => {
    for (const p of ["/new", "/o/abc", "/d/123456", "/library/extra", "/admin"]) {
      expect(sanitizeNext(p), p).toBe("/library");
    }
  });

  it("rejects open-redirect / off-origin attempts", () => {
    for (const evil of [
      "//evil.com",
      "https://evil.com",
      "http://evil.com/library",
      "//evil.com/library",
      "/\\evil.com",
      "\\/evil.com",
      "javascript:alert(1)",
      "mailto:x@y.z",
    ]) {
      expect(sanitizeNext(evil), evil).toBe("/library");
    }
  });
});
