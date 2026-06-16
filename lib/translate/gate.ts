/**
 * Pure pre-flight gate for the translate route — decides, WITHOUT any I/O or the
 * model, whether a translate request should even reach Claude. Extracted so the
 * "don't burn quota on ended sessions / non-translatable frames" rules are
 * unit-tested directly.
 *
 * The route applies these in order and only calls the (paid) translator when the
 * decision is `proceed`.
 */
import type { WebFrame } from "@/lib/webframe";
import { SENSITIVE_PLACEHOLDER } from "@/lib/webframe";

/** Minimal session shape the gate needs (full row not required). */
export interface SessionLike {
  status: "live" | "ended";
}

export type TranslateGate =
  | { decision: "proceed" }
  /** HTTP failure (session missing or no longer live). */
  | { decision: "fail"; status: number; error: string }
  /** Soft pass-through: return null + this source, show the original. */
  | { decision: "skip"; source: "passthrough" | "not_translatable" };

/**
 * Decide the fate of a translate request. `session` is null when the id does not
 * resolve. An ENDED session yields 410 (gone) so phones stop spending quota
 * after the service has wrapped up.
 */
export function evaluateTranslateGate(
  session: SessionLike | null,
  frame: WebFrame,
): TranslateGate {
  if (!session) return { decision: "fail", status: 404, error: "not_found" };
  if (session.status !== "live") return { decision: "fail", status: 410, error: "session_ended" };

  // Only slide frames carry translatable lyric/scripture lines.
  if (frame.kind !== "slide" || !frame.text_lines || frame.text_lines.length === 0) {
    return { decision: "skip", source: "not_translatable" };
  }

  // NEVER translate gated content — belt-and-suspenders against the placeholder.
  if (frame.text_lines.some((line) => line === SENSITIVE_PLACEHOLDER)) {
    return { decision: "skip", source: "not_translatable" };
  }

  // The display already carries this language — nothing to do.
  if (frame.translation_lines && frame.translation_lines.length > 0) {
    return { decision: "skip", source: "passthrough" };
  }

  return { decision: "proceed" };
}
