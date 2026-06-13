import "server-only";

/**
 * Translation cache — every DB touch for the translate route, service-role
 * only (RLS deny-all, like the rest of the `stage` schema). Cost is paid ONCE
 * per (slide, target language) and read by every phone after that, keyed by a
 * stable hash of the translatable content — not by seq, so the same slide
 * shown twice reuses the cache.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/lib/server/sessions";
import type { Locale } from "@/lib/locale/i18n";
import type { TranslateResult } from "./prompt";

/**
 * Stable hash over exactly what gets translated (lines + label). Independent
 * of seq/appearance/reference so repeats hit the cache. Newline-joined with a
 * field separator that can't collide with line content order.
 */
export async function frameHash(input: {
  text_lines: string[];
  section_label?: string | null;
}): Promise<string> {
  const canonical = JSON.stringify({
    text_lines: input.text_lines,
    section_label: input.section_label ?? null,
  });
  return sha256Hex(canonical);
}

/** Read a cached translation, or null on miss. */
export async function getCachedTranslation(
  sessionId: string,
  hash: string,
  target: Locale,
): Promise<TranslateResult | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("translation")
    .select("text_lines, section_label")
    .eq("session_id", sessionId)
    .eq("frame_hash", hash)
    .eq("target_lang", target)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    text_lines: (data.text_lines as string[]) ?? [],
    section_label: (data.section_label as string | null) ?? null,
  };
}

/**
 * Idempotent upsert: paid once per (session, hash, target). Concurrent phones
 * racing the same miss collapse onto one row via the unique constraint — the
 * second writer's ON CONFLICT DO NOTHING is harmless.
 */
export async function putCachedTranslation(
  sessionId: string,
  hash: string,
  target: Locale,
  result: TranslateResult,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("translation").upsert(
    {
      session_id: sessionId,
      frame_hash: hash,
      target_lang: target,
      text_lines: result.text_lines,
      section_label: result.section_label,
    },
    { onConflict: "session_id,frame_hash,target_lang", ignoreDuplicates: true },
  );
  if (error) throw error;
}
