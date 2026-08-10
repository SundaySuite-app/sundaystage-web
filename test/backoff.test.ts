import { describe, expect, it } from "vitest";
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  backoffDelay,
  foldOutcome,
} from "@/lib/client/backoff";

describe("backoffDelay", () => {
  it("doubles from the base and caps — 3→6→12→24→48→60→60", () => {
    expect(backoffDelay(0)).toBe(3_000);
    expect(backoffDelay(1)).toBe(6_000);
    expect(backoffDelay(2)).toBe(12_000);
    expect(backoffDelay(3)).toBe(24_000);
    expect(backoffDelay(4)).toBe(48_000);
    expect(backoffDelay(5)).toBe(60_000); // 96 s → capped
    expect(backoffDelay(6)).toBe(60_000);
    expect(backoffDelay(50)).toBe(60_000); // huge counts never overflow the cap
  });

  it("the base is the fast first retry and the cap is the ceiling", () => {
    expect(backoffDelay(0)).toBe(BACKOFF_MIN_MS);
    expect(backoffDelay(99)).toBe(BACKOFF_MAX_MS);
  });

  it("treats garbage / negative failure counts as zero (fast base)", () => {
    expect(backoffDelay(-1)).toBe(BACKOFF_MIN_MS);
    expect(backoffDelay(Number.NaN)).toBe(BACKOFF_MIN_MS);
    expect(backoffDelay(Number.POSITIVE_INFINITY)).toBe(BACKOFF_MIN_MS); // non-finite → 0
    expect(backoffDelay(1.9)).toBe(6_000); // floored to 1
  });

  it("honours custom bounds", () => {
    expect(backoffDelay(0, 1_000, 10_000)).toBe(1_000);
    expect(backoffDelay(1, 1_000, 10_000)).toBe(2_000);
    expect(backoffDelay(10, 1_000, 10_000)).toBe(10_000);
  });
});

describe("foldOutcome (progression + reset-on-success)", () => {
  it("a failure grows the delay, a success snaps back to fast", () => {
    // Extended outage: consecutive failures walk the backoff up.
    let failures = 0;
    expect(backoffDelay(failures)).toBe(3_000); // first disconnected poll
    failures = foldOutcome(failures, false);
    expect(backoffDelay(failures)).toBe(6_000);
    failures = foldOutcome(failures, false);
    expect(backoffDelay(failures)).toBe(12_000);
    failures = foldOutcome(failures, false);
    expect(backoffDelay(failures)).toBe(24_000);

    // Server comes back: the very next success resets to the fast base.
    failures = foldOutcome(failures, true);
    expect(failures).toBe(0);
    expect(backoffDelay(failures)).toBe(3_000);

    // And it climbs again on the next failure streak.
    failures = foldOutcome(failures, false);
    expect(backoffDelay(failures)).toBe(6_000);
  });

  it("increments defensively from a garbage count", () => {
    expect(foldOutcome(Number.NaN, false)).toBe(1);
    expect(foldOutcome(-5, false)).toBe(1);
    expect(foldOutcome(2.7, false)).toBe(3);
    expect(foldOutcome(9, true)).toBe(0);
  });
});
