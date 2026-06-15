import { describe, expect, it } from "vitest";
import { moveSlide, removeSlideAt, updateSlideAt, reindexCurrent } from "@/lib/setlist";
import type { SlideDef } from "@/lib/sections";

const S = (label: string): SlideDef => ({ label, lines: [label] });
const list = (): SlideDef[] => [S("A"), S("B"), S("C"), S("D")];

describe("moveSlide", () => {
  it("moves down and returns a new array", () => {
    const before = list();
    const after = moveSlide(before, 0, 2);
    expect(after.map((s) => s.label)).toEqual(["B", "C", "A", "D"]);
    expect(after).not.toBe(before);
  });
  it("moves up", () => {
    expect(moveSlide(list(), 3, 0).map((s) => s.label)).toEqual(["D", "A", "B", "C"]);
  });
  it("clamps an out-of-range target and ignores no-op / OOB source", () => {
    expect(moveSlide(list(), 1, 99).map((s) => s.label)).toEqual(["A", "C", "D", "B"]);
    expect(moveSlide(list(), 5, 0)).toEqual(list());
    expect(moveSlide(list(), 2, 2)).toEqual(list());
  });
});

describe("removeSlideAt", () => {
  it("removes the indexed slide", () => {
    expect(removeSlideAt(list(), 1).map((s) => s.label)).toEqual(["A", "C", "D"]);
  });
  it("ignores out of range", () => {
    expect(removeSlideAt(list(), 9)).toEqual(list());
  });
});

describe("updateSlideAt", () => {
  it("patches lines immutably", () => {
    const before = list();
    const after = updateSlideAt(before, 0, { lines: ["x", "y"] });
    expect(after[0]).toEqual({ label: "A", lines: ["x", "y"] });
    expect(before[0].lines).toEqual(["A"]); // original untouched
  });
});

describe("reindexCurrent", () => {
  it("remove before current shifts it down", () => {
    expect(reindexCurrent(2, { type: "remove", index: 0 }, 4)).toBe(1);
  });
  it("remove after current leaves it", () => {
    expect(reindexCurrent(1, { type: "remove", index: 3 }, 4)).toBe(1);
  });
  it("remove current points at the slide that took its place", () => {
    expect(reindexCurrent(1, { type: "remove", index: 1 }, 4)).toBe(1);
  });
  it("remove current when it was last clamps to the new last", () => {
    expect(reindexCurrent(3, { type: "remove", index: 3 }, 4)).toBe(2);
  });
  it("remove the only slide yields -1", () => {
    expect(reindexCurrent(0, { type: "remove", index: 0 }, 1)).toBe(-1);
  });
  it("nothing shown stays -1", () => {
    expect(reindexCurrent(-1, { type: "remove", index: 0 }, 4)).toBe(-1);
  });
  it("moving the current slide follows it", () => {
    expect(reindexCurrent(0, { type: "move", from: 0, to: 2 }, 4)).toBe(2);
  });
  it("reindexes a bystander when a slide jumps across it", () => {
    expect(reindexCurrent(2, { type: "move", from: 0, to: 3 }, 4)).toBe(1);
    expect(reindexCurrent(1, { type: "move", from: 3, to: 0 }, 4)).toBe(2);
  });
});
