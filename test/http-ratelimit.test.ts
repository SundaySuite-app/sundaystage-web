import { describe, expect, it } from "vitest";
import { bearer, clientIp, rateLimit, rateLimitBucketCount } from "@/lib/server/http";

const WINDOW = 60_000;
const t0 = 1_700_000_000_000;

describe("rateLimit", () => {
  it("allows up to the limit inside the window, then rejects", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("basic", 3, WINDOW, t0)).toBe(true);
    expect(rateLimit("basic", 3, WINDOW, t0)).toBe(false);
  });

  it("opens a fresh bucket once the window has passed", () => {
    expect(rateLimit("window", 1, WINDOW, t0)).toBe(true);
    expect(rateLimit("window", 1, WINDOW, t0 + 1)).toBe(false);
    expect(rateLimit("window", 1, WINDOW, t0 + WINDOW + 1)).toBe(true);
  });
});

describe("rateLimit bucket eviction (S5 regression)", () => {
  it("reclaims expired buckets instead of growing with every distinct IP", () => {
    const before = rateLimitBucketCount();

    // A stream of one-shot visitors — an isolate serving a real congregation.
    for (let i = 0; i < 500; i++) rateLimit(`sweep:${i}`, 30, WINDOW, t0);
    expect(rateLimitBucketCount()).toBe(before + 500);

    // Long after their windows closed, later traffic sweeps them away. The sweep
    // is bounded per call, so a handful of writes drains a large backlog.
    const later = t0 + WINDOW + 1;
    for (let i = 0; i < 5; i++) rateLimit(`after:${i}`, 30, WINDOW, later);

    expect(rateLimitBucketCount()).toBeLessThan(before + 100);
  });

  it("never evicts a bucket that is still inside its window", () => {
    const live = "live:keep-me";
    expect(rateLimit(live, 2, WINDOW, t0)).toBe(true);
    // Churn enough new keys to run the sweep several times over.
    for (let i = 0; i < 300; i++) rateLimit(`churn:${i}`, 30, WINDOW, t0 + 10);
    // Still counted against the same bucket: the second call consumes the limit,
    // the third is refused. A dropped bucket would have restarted the count.
    expect(rateLimit(live, 2, WINDOW, t0 + 20)).toBe(true);
    expect(rateLimit(live, 2, WINDOW, t0 + 30)).toBe(false);
  });
});

describe("request helpers", () => {
  it("reads the first x-forwarded-for hop, falling back to local", () => {
    const withFwd = new Request("https://x/", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
    });
    expect(clientIp(withFwd)).toBe("203.0.113.7");
    expect(clientIp(new Request("https://x/"))).toBe("local");
  });

  it("extracts a Bearer token case-insensitively", () => {
    const req = new Request("https://x/", { headers: { authorization: "bearer  abc123 " } });
    expect(bearer(req)).toBe("abc123");
    expect(bearer(new Request("https://x/"))).toBeNull();
  });
});
