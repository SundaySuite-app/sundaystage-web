/**
 * Per-pew live auto-translation — PURE request-builder + response-parser.
 *
 * No network, no key, no app state here. The server route (translate/route.ts)
 * owns the Anthropic call and the cache; this module is just the two pure
 * functions around it, so the real test coverage lives in plain vitest with
 * canned fixtures (see test/translate.test.ts).
 *
 * The LLM only SUGGESTS the translation text. The server validates the parsed
 * shape against a strict zod schema, enforces the line count, and decides what
 * (if anything) reaches the follower — the model never bypasses the
 * SENSITIVE-gate or the WebFrame contract.
 */
import { z } from "zod";
import { LOCALES, type Locale } from "@/lib/locale/i18n";

/** Match the repo's Anthropic model constant elsewhere in the suite. */
export const TRANSLATE_MODEL = "claude-opus-4-8";

/** Hard cap mirrors WebFrame.text_lines (.max(40)); keep prompts bounded. */
export const MAX_TRANSLATE_LINES = 40;

/** Human-readable target-language names for the prompt (Norwegian-first UX). */
const LANGUAGE_NAMES: Record<Locale, string> = {
  no: "norsk (bokmål)",
  en: "engelsk",
  sv: "svensk",
  da: "dansk",
  de: "tysk",
  fr: "fransk",
  pl: "polsk",
};

/** What the server hands the builder — the translatable slice of a slide. */
export interface TranslateInput {
  /** The slide's lyric/scripture lines, in their original language. */
  text_lines: string[];
  /** Optional section label ("Vers 1", "Refreng", …). */
  section_label?: string | null;
  /** Target locale (one of the 7 the app supports). */
  target: Locale;
}

/** The strict shape we demand back from the model before trusting it. */
export const TranslateResult = z.object({
  text_lines: z.array(z.string().max(500)).max(MAX_TRANSLATE_LINES),
  section_label: z.string().max(80).nullable(),
});
export type TranslateResult = z.infer<typeof TranslateResult>;

/** True when this locale is a real target we can translate into. */
export function isTranslatableLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

const SYSTEM_PROMPT = [
  "Du er en varsom oversetter for en kristen gudstjeneste.",
  "Du oversetter sangtekst, salmevers og bibelhenvisninger som vises på",
  "skjermen i benkeraden, slik at folk kan følge med på sitt eget språk.",
  "",
  "Regler:",
  "- Behold linjeinndelingen NØYAKTIG: like mange linjer ut som inn, i samme",
  "  rekkefølge. Tomme linjer forblir tomme.",
  "- Oversett betydningen naturlig og syngbart, ikke ord-for-ord stivt.",
  "- Behold bibelske egennavn og kjente begreper slik de skrives på målspråket.",
  "- Ikke legg til, forklar, kommenter eller utelat noe. Ingen anførselstegn",
  "  rundt linjene.",
  "- Svar KUN med gyldig JSON på formen {\"text_lines\": [...], \"section_label\": \"...\"|null}.",
].join("\n");

/**
 * Build the Anthropic Messages API request body for one slide → one language.
 * Pure: same input → same bytes (stable for caching upstream).
 */
export function buildTranslateRequest(input: TranslateInput): {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: "user"; content: string }[];
} {
  const languageName = LANGUAGE_NAMES[input.target];
  const payload = {
    target_language: languageName,
    section_label: input.section_label ?? null,
    text_lines: input.text_lines,
  };
  const userContent = [
    `Oversett følgende til ${languageName}.`,
    "Behold antall linjer og rekkefølge. Returner kun JSON.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");

  return {
    model: TRANSLATE_MODEL,
    // Generous but bounded: 40 lines of lyric text fits comfortably.
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  };
}

/**
 * Extract the concatenated text from an Anthropic Messages API response.
 * Tolerates the SDK-shaped `{ content: [{ type: "text", text }] }` envelope.
 */
export function extractText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("");
}

/**
 * Parse + validate the model's output for ONE slide against the original.
 * Returns null on any mismatch (bad JSON, wrong line count, schema miss) so the
 * caller falls back to the original language — the model never half-wins.
 *
 * `expectedLines` is the original line count; we refuse a translation that
 * doesn't preserve it, because the display renders translation_lines[i]
 * paired with text_lines[i].
 */
export function parseTranslateResult(
  rawText: string,
  expectedLines: number,
): TranslateResult | null {
  const json = extractFirstJsonObject(rawText);
  if (json === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  const parsed = TranslateResult.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.text_lines.length !== expectedLines) return null;
  return parsed.data;
}

/**
 * Pull the first balanced top-level JSON object out of a string. The model is
 * told to return bare JSON, but this tolerates accidental prose/fences around
 * it without trusting a greedy regex.
 */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
