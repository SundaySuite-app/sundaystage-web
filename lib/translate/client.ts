import "server-only";

/**
 * The LLM seam — SERVER ONLY. Mirrors lib/server/broadcast.ts: read the key
 * from the environment, and if it is missing, become a graceful no-op
 * (`getTranslator()` returns null). The feature then degrades to "followers
 * see the original language" — it never crashes and never blocks the live
 * flow. The Anthropic key lives ONLY here, server-side; it is never bundled to
 * the browser (the `server-only` guard enforces that at build time).
 *
 * Uses the Anthropic Messages API over fetch (no SDK dependency, matching the
 * repo's dependency-light REST style in broadcast.ts). The request body is
 * built by the PURE buildTranslateRequest(); this module only adds the network.
 */
import { buildTranslateRequest, type TranslateInput } from "./prompt";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface Translator {
  /** Returns the raw Anthropic response object, or throws on transport error.
   * Pass it to extractText() (pure) to get the model's text. */
  translate(input: TranslateInput): Promise<unknown>;
}

/**
 * Returns a Translator bound to the server-side key, or null when no key is
 * configured. Callers MUST treat null as "AI ikke tilgjengelig" and fall back
 * to the original language.
 */
export function getTranslator(): Translator | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  return {
    async translate(input: TranslateInput): Promise<unknown> {
      const body = buildTranslateRequest(input);
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`anthropic ${res.status}: ${detail.slice(0, 200)}`);
      }
      return res.json();
    },
  };
}
