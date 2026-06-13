import { describe, expect, it } from "vitest";
import {
  TRANSLATE_MODEL,
  buildTranslateRequest,
  extractText,
  parseTranslateResult,
  isTranslatableLocale,
} from "@/lib/translate/prompt";

describe("buildTranslateRequest (pure request-builder)", () => {
  const input = {
    text_lines: ["Stor er din trofasthet", "å Gud min Far"],
    section_label: "Vers 1",
    target: "en" as const,
  };

  it("uses the repo's current Opus model id", () => {
    expect(buildTranslateRequest(input).model).toBe("claude-opus-4-8");
    expect(TRANSLATE_MODEL).toBe("claude-opus-4-8");
  });

  it("is deterministic: same input → byte-identical body (cache-stable)", () => {
    const a = JSON.stringify(buildTranslateRequest(input));
    const b = JSON.stringify(buildTranslateRequest(input));
    expect(a).toBe(b);
  });

  it("embeds the lines, label and human-readable target language", () => {
    const body = buildTranslateRequest(input);
    const user = body.messages[0].content;
    expect(user).toContain("Stor er din trofasthet");
    expect(user).toContain("Vers 1");
    expect(user).toContain("engelsk");
    expect(body.system).toContain("oversetter");
  });

  it("never demands more output than the line cap allows", () => {
    expect(buildTranslateRequest(input).max_tokens).toBeGreaterThan(0);
  });
});

describe("isTranslatableLocale", () => {
  it("accepts the 7 supported locales, rejects everything else", () => {
    for (const loc of ["no", "en", "sv", "da", "de", "fr", "pl"]) {
      expect(isTranslatableLocale(loc)).toBe(true);
    }
    expect(isTranslatableLocale("es")).toBe(false);
    expect(isTranslatableLocale("")).toBe(false);
    expect(isTranslatableLocale(null)).toBe(false);
    expect(isTranslatableLocale(42)).toBe(false);
  });
});

describe("extractText (Anthropic response envelope)", () => {
  it("concatenates text blocks, ignoring non-text", () => {
    const resp = {
      content: [
        { type: "text", text: "{\"text_lines\":" },
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: "[\"x\"]}" },
      ],
    };
    expect(extractText(resp)).toBe('{"text_lines":["x"]}');
  });

  it("returns empty string on junk shapes", () => {
    expect(extractText(null)).toBe("");
    expect(extractText({})).toBe("");
    expect(extractText({ content: "nope" })).toBe("");
    expect(extractText({ content: [{ type: "text" }] })).toBe("");
  });
});

describe("parseTranslateResult (validate the model's suggestion)", () => {
  it("accepts a clean JSON object with matching line count", () => {
    const raw = JSON.stringify({
      text_lines: ["Great is thy faithfulness", "O God my Father"],
      section_label: "Verse 1",
    });
    const out = parseTranslateResult(raw, 2);
    expect(out).toEqual({
      text_lines: ["Great is thy faithfulness", "O God my Father"],
      section_label: "Verse 1",
    });
  });

  it("tolerates prose/fences around the JSON", () => {
    const raw = "Here you go:\n```json\n{\"text_lines\":[\"Hallo\"],\"section_label\":null}\n```\nDone.";
    expect(parseTranslateResult(raw, 1)).toEqual({
      text_lines: ["Hallo"],
      section_label: null,
    });
  });

  it("REJECTS a translation that changes the line count (display pairs by index)", () => {
    const raw = JSON.stringify({ text_lines: ["one line only"], section_label: null });
    expect(parseTranslateResult(raw, 3)).toBeNull();
  });

  it("rejects malformed JSON → caller falls back to original", () => {
    expect(parseTranslateResult("not json at all", 1)).toBeNull();
    expect(parseTranslateResult("", 1)).toBeNull();
  });

  it("rejects a schema miss (wrong types)", () => {
    expect(parseTranslateResult('{"text_lines": "should be array"}', 1)).toBeNull();
    expect(parseTranslateResult('{"text_lines": [1, 2]}', 2)).toBeNull();
  });

  it("rejects over-long output (line cap)", () => {
    const lines = Array(41).fill("x");
    const raw = JSON.stringify({ text_lines: lines, section_label: null });
    expect(parseTranslateResult(raw, 41)).toBeNull();
  });
});
