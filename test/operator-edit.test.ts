import { describe, expect, it } from "vitest";
import { editTextToLines } from "@/lib/operator/edit";

describe("editTextToLines (shared by live preview + save)", () => {
  it("splits on newlines and trims each line", () => {
    expect(editTextToLines("  a \n b  \nc")).toEqual(["a", "b", "c"]);
  });

  it("drops blank / whitespace-only lines", () => {
    expect(editTextToLines("a\n\n   \nb")).toEqual(["a", "b"]);
  });

  it("returns [] for empty / whitespace input (caller cancels the edit)", () => {
    expect(editTextToLines("")).toEqual([]);
    expect(editTextToLines("   \n  \n")).toEqual([]);
  });

  it("normalises a single line", () => {
    expect(editTextToLines("  Stor er din trofasthet  ")).toEqual(["Stor er din trofasthet"]);
  });
});
