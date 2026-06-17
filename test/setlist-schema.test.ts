import { describe, expect, it } from "vitest";
import { SetlistSchema } from "@/lib/setlist";

const valid = {
  slides: [
    { label: "Vers 1", lines: ["Stor er din trofasthet", "å Gud min Far"] },
    { label: null, lines: ["én linje"] },
  ],
  current: 1,
};

describe("SetlistSchema (PUT /setlist write validation)", () => {
  it("accepts a well-formed setlist and strips unknown keys", () => {
    const out = SetlistSchema.safeParse({ ...valid, junk: "x" });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.slides).toHaveLength(2);
      expect((out.data as Record<string, unknown>).junk).toBeUndefined();
    }
  });

  it("accepts the empty / nothing-shown resume state (current = -1)", () => {
    expect(SetlistSchema.safeParse({ slides: [], current: -1 }).success).toBe(true);
  });

  it("rejects a non-array slides field", () => {
    expect(SetlistSchema.safeParse({ slides: "nope", current: 0 }).success).toBe(false);
  });

  it("rejects a missing current index", () => {
    expect(SetlistSchema.safeParse({ slides: [] }).success).toBe(false);
  });

  it("rejects current below -1 and non-integers", () => {
    expect(SetlistSchema.safeParse({ slides: [], current: -2 }).success).toBe(false);
    expect(SetlistSchema.safeParse({ slides: [], current: 1.5 }).success).toBe(false);
  });

  it("rejects a slide line that is not a string", () => {
    const bad = { slides: [{ label: null, lines: [1, 2] }], current: 0 };
    expect(SetlistSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a slide with too many lines (over the cap)", () => {
    const bad = { slides: [{ label: null, lines: Array(41).fill("x") }], current: 0 };
    expect(SetlistSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an over-long label", () => {
    const bad = { slides: [{ label: "x".repeat(81), lines: ["a"] }], current: 0 };
    expect(SetlistSchema.safeParse(bad).success).toBe(false);
  });
});
