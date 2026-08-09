import { describe, expect, it } from "vitest";
import { createCmdSeq } from "@/lib/operator/cmdSeq";

/** A clock the test drives by hand. */
function fakeClock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("createCmdSeq", () => {
  it("is strictly increasing even when taps land in the same millisecond", () => {
    const clock = fakeClock(1_700_000_000_000);
    const next = createCmdSeq(clock.now);
    const burst = [next(), next(), next(), next()];
    for (let i = 1; i < burst.length; i++) expect(burst[i]).toBeGreaterThan(burst[i - 1]);
  });

  it("does not regress if the clock steps backwards mid-mount (NTP correction)", () => {
    const clock = fakeClock(1_700_000_000_000);
    const next = createCmdSeq(clock.now);
    const first = next();
    clock.advance(-5_000);
    expect(next()).toBeGreaterThan(first);
  });

  it("a remount continues ABOVE every value the previous mount sent", () => {
    // The regression: the desktop drops any cmd_seq <= the highest it has seen
    // for the session. With the old 0-based useState counter, mount 2 restarted
    // at 1 and its first 8 taps were 200-but-ignored — remote silently dead.
    const clock = fakeClock(1_700_000_000_000);

    const mount1 = createCmdSeq(clock.now);
    const sentBefore: number[] = [];
    for (let i = 0; i < 8; i++) {
      sentBefore.push(mount1());
      clock.advance(400); // ~2-3 taps/s of fast advancing
    }

    clock.advance(3_000); // phone reloads
    const mount2 = createCmdSeq(clock.now);
    const sentAfter = [mount2(), mount2(), mount2()];

    const highestSeen = Math.max(...sentBefore);
    for (const seq of sentAfter) expect(seq).toBeGreaterThan(highestSeen);
  });

  it("emits integers the command route accepts (finite, >= 0)", () => {
    const next = createCmdSeq(() => 1_700_000_000_000.7);
    const seq = next();
    expect(Number.isInteger(seq)).toBe(true);
    expect(seq).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(seq)).toBe(true);
  });
});
