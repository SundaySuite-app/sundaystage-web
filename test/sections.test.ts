import { describe, expect, it } from "vitest";
import { isHeaderLine, pasteToSlides, splitSections } from "@/lib/sections";

const SONG = `[Vers 1]
Stor er din trofasthet
å Gud min Far

Refreng:
Stor er din trofasthet
mot meg

Bridge
Alt jeg har
gav du meg`;

describe("isHeaderLine", () => {
  it("recognizes headers in the suite's languages", () => {
    for (const h of [
      "[Verse 1]", "Chorus", "Refreng:", "vers 2", "[Bridge]", "Refräng", "Strophe 1",
      "Couplet 2", "Zwrotka 1", "PRE-CHORUS",
    ]) {
      expect(isHeaderLine(h), h).toBe(true);
    }
  });
  it("does not eat lyric lines", () => {
    for (const l of ["Verse meg din nåde", "Refrenget vi alltid synger", "Stor er din trofasthet"]) {
      expect(isHeaderLine(l), l).toBe(false);
    }
  });
});

describe("splitSections", () => {
  it("splits on blank lines and headers, labeling sections", () => {
    const sections = splitSections(SONG);
    expect(sections.map((s) => s.label)).toEqual(["Vers 1", "Refreng", "Bridge"]);
    expect(sections[0].lines).toEqual(["Stor er din trofasthet", "å Gud min Far"]);
  });

  it("handles unlabeled plain paste", () => {
    const sections = splitSections("linje en\nlinje to\n\nlinje tre");
    expect(sections).toHaveLength(2);
    expect(sections[0].label).toBeNull();
  });

  it("normalizes CRLF and trims trailing space", () => {
    const sections = splitSections("a  \r\nb\r\n\r\nc");
    expect(sections[0].lines).toEqual(["a", "b"]);
  });
});

describe("pasteToSlides", () => {
  it("re-splits long sections at maxLines with balanced halves", () => {
    const text = ["1", "2", "3", "4", "5", "6"].join("\n");
    const slides = pasteToSlides(text, 4);
    expect(slides.map((s) => s.lines.length)).toEqual([3, 3]); // balanced, not 4+2
  });

  it("keeps the section label on every continuation slide", () => {
    const slides = pasteToSlides("[Vers 1]\n1\n2\n3\n4\n5", 4);
    expect(slides).toHaveLength(2);
    expect(slides.every((s) => s.label === "Vers 1")).toBe(true);
  });
});
