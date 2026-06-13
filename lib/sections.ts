/**
 * Paste-to-slides: turn plain pasted lyrics into sections and display slides.
 *
 * Deliberately simple (the desktop app owns the real editor + AI formatter):
 * blank lines split sections; a line that *is* a section header (`[Vers 1]`,
 * `Chorus`, `Refreng:` …) labels the section that follows; long sections are
 * re-split so no slide exceeds `maxLines`. Pure + unit-tested.
 */

export interface Section {
  label: string | null;
  lines: string[];
}

export interface SlideDef {
  label: string | null;
  lines: string[];
}

/** Section-header words across the suite's 7 locales (case-insensitive). */
const HEADER_WORDS = [
  // en
  "verse", "chorus", "bridge", "intro", "outro", "tag", "pre-chorus", "prechorus", "refrain", "ending",
  // no/da
  "vers", "refreng", "bro", "stikk", "omkved",
  // sv
  "refräng", "brygga", "stick",
  // de
  "strophe", "refrain", "brücke", "schluss",
  // fr
  "couplet", "refrain", "pont", "final",
  // pl
  "zwrotka", "refren", "mostek",
];

const HEADER_RE = new RegExp(
  `^\\s*\\[?\\s*(?:${HEADER_WORDS.join("|")})\\s*\\d*\\s*\\]?\\s*:?\\s*$`,
  "i",
);

/** True when a line is a section header rather than lyric content. */
export function isHeaderLine(line: string): boolean {
  return HEADER_RE.test(line);
}

/** Normalize a recognized header to a display label ("[vers 2]" → "Vers 2"). */
function headerLabel(line: string): string {
  const cleaned = line.replace(/[\[\]:]/g, "").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase().replace(/\s+/g, " ");
}

/** Split pasted text into labeled sections. */
export function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  const flush = () => {
    if (current && current.lines.length > 0) sections.push(current);
    current = null;
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (isHeaderLine(line)) {
      flush();
      current = { label: headerLabel(line), lines: [] };
      continue;
    }
    if (!current) current = { label: null, lines: [] };
    current.lines.push(line.trim());
  }
  flush();
  return sections;
}

/** Break sections into slides of at most `maxLines` lines (balanced halves
 * rather than a full last slide with a 1-line orphan). */
export function sectionsToSlides(sections: Section[], maxLines = 4): SlideDef[] {
  const slides: SlideDef[] = [];
  for (const s of sections) {
    if (s.lines.length <= maxLines) {
      slides.push({ label: s.label, lines: s.lines });
      continue;
    }
    const parts = Math.ceil(s.lines.length / maxLines);
    const per = Math.ceil(s.lines.length / parts);
    for (let i = 0; i < s.lines.length; i += per) {
      slides.push({ label: s.label, lines: s.lines.slice(i, i + per) });
    }
  }
  return slides;
}

/** One-call convenience for the operator UI. */
export function pasteToSlides(text: string, maxLines = 4): SlideDef[] {
  return sectionsToSlides(splitSections(text), maxLines);
}
