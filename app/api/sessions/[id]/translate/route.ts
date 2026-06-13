/**
 * POST /api/sessions/<id>/translate — per-pew live auto-translation.
 *
 * A follower on /f/<code> requests the current slide in their own language.
 * If the frame already carries translation_lines, we don't need this. When it
 * doesn't, we translate via Claude (server-side key) and CACHE the result by
 * (frame hash, target lang) so the cost is paid once per slide, not once per
 * phone. The follower polls/refetches this on each seq change.
 *
 * Body: { frame: WebFrame, target: Locale }
 * Response (200): { translation: { text_lines, section_label } | null, source }
 *   - `translation: null` + a `source` reason ALWAYS means "show the original".
 *   - Never 5xx on a translation failure — degrade gracefully to original.
 *
 * Hard rules:
 *   - NEVER translate SENSITIVE/gated frames (kind:"message" carrying the
 *     SENSITIVE_PLACEHOLDER) — private content never leaves the building and is
 *     never sent to the model.
 *   - No bearer secret required: this is a read-side follower convenience, like
 *     by-code/state. It only ever returns translations of content the session
 *     already broadcast, scoped to that session id.
 */
import { ok, fail, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { getById } from "@/lib/server/sessions";
import { WebFrame, SENSITIVE_PLACEHOLDER } from "@/lib/webframe";
import { isTranslatableLocale, parseTranslateResult, extractText } from "@/lib/translate/prompt";
import { getTranslator } from "@/lib/translate/client";
import { frameHash, getCachedTranslation, putCachedTranslation } from "@/lib/translate/store";

/** `source` tells the client why it got what it got (debuggable, honest). */
type Source = "cache" | "fresh" | "passthrough" | "no_key" | "not_translatable" | "error";

function reply(translation: unknown, source: Source) {
  return ok({ translation, source });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // Cheap abuse guard (per-process best-effort, like the rest of the app).
  if (!rateLimit(`translate:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }

  const body = await readJson<{ frame?: unknown; target?: unknown }>(req);
  const parsedFrame = WebFrame.safeParse(body?.frame);
  if (!parsedFrame.success) return fail(400, "invalid_frame");
  if (!isTranslatableLocale(body?.target)) return fail(400, "invalid_target");
  const frame = parsedFrame.data;
  const target = body.target;

  // The session must exist and be live (scopes the cache + blocks stale ids).
  const session = await getById(id);
  if (!session) return fail(404, "not_found");

  // Only slide frames carry translatable lyric/scripture lines.
  if (frame.kind !== "slide" || !frame.text_lines || frame.text_lines.length === 0) {
    return reply(null, "not_translatable");
  }

  // NEVER translate gated content. The sender collapses sensitive slides to a
  // kind:"message" placeholder, but belt-and-suspenders: refuse to translate
  // anything that even equals the placeholder text.
  if (frame.text_lines.some((line) => line === SENSITIVE_PLACEHOLDER)) {
    return reply(null, "not_translatable");
  }

  // The display already speaks this language — nothing to do.
  if (frame.translation_lines && frame.translation_lines.length > 0) {
    return reply(null, "passthrough");
  }

  const hash = await frameHash({
    text_lines: frame.text_lines,
    section_label: frame.section_label ?? null,
  });

  // 1. Cache hit — the common path once one phone has paid for the slide.
  try {
    const cached = await getCachedTranslation(id, hash, target);
    if (cached) return reply(cached, "cache");
  } catch {
    // Cache read failure is non-fatal — fall through to a fresh attempt.
  }

  // 2. No key → graceful "AI ikke tilgjengelig": followers see the original.
  const translator = getTranslator();
  if (!translator) return reply(null, "no_key");

  // 3. Fresh translation. Any failure → original language, never a 5xx.
  try {
    const raw = await translator.translate({
      text_lines: frame.text_lines,
      section_label: frame.section_label ?? null,
      target,
    });
    const result = parseTranslateResult(extractText(raw), frame.text_lines.length);
    if (!result) return reply(null, "error");

    // Best-effort cache write; a failure here just means the next phone re-pays.
    try {
      await putCachedTranslation(id, hash, target, result);
    } catch {
      // swallow — the translation is still valid to return now
    }
    return reply(result, "fresh");
  } catch {
    return reply(null, "error");
  }
}
