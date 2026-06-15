import "server-only";

/**
 * Data layer for the shared church song library (`stage.library_song`). Service
 * role only, mirrors lib/server/sessions.ts. The web operator READS via the GET
 * route (cookie-auth → church); the desktop PUBLISHES via the bearer-authed
 * route → the LWW-guarded `library_upsert` RPC (Fase A migration).
 */
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";

/** One slide-shaped section (matches the operator's SlideDef). */
export const PublishSection = z.object({
  label: z.string().max(80).nullish(),
  lines: z.array(z.string().max(500)).max(60),
});

/** A song as the desktop publishes it (denormalised, SlideDef-shaped). */
export const PublishSong = z.object({
  source_song_id: z.string().min(1).max(64),
  title: z.string().max(300),
  sections: z.array(PublishSection).max(200),
  arrangement: z.array(z.string().max(80)).max(200).nullish(),
  ccli_song_id: z.string().max(40).nullish(),
  tono_work_id: z.string().max(40).nullish(),
  copyright_notice: z.string().max(500).nullish(),
  language: z.string().max(8).default("no"),
  default_key: z.string().max(8).nullish(),
  source_updated_at: z.number().int().nonnegative(),
});
export type PublishSong = z.infer<typeof PublishSong>;

/** The publish request body. `church_id` is validated against token claims. */
export const PublishBody = z.object({
  church_id: z.string().uuid(),
  songs: z.array(PublishSong).max(2000),
  deleted: z.array(z.string().min(1).max(64)).max(2000).optional(),
});
export type PublishBody = z.infer<typeof PublishBody>;

/** A song as the operator reads it back. */
export interface LibrarySong {
  id: string;
  title: string;
  sections: { label?: string | null; lines: string[] }[];
  language: string;
  ccli_song_id?: string | null;
  tono_work_id?: string | null;
  copyright_notice?: string | null;
  default_key?: string | null;
}

const READ_COLS =
  "id, title, sections, language, ccli_song_id, tono_work_id, copyright_notice, default_key";

export async function listLibrarySongs(churchId: string): Promise<LibrarySong[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("library_song")
    .select(READ_COLS)
    .eq("church_id", churchId)
    .is("deleted_at", null)
    .order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LibrarySong[];
}

export async function publishLibrary(
  churchId: string,
  songs: PublishSong[],
  deleted: string[] = [],
): Promise<{ upserted: number; deleted: number }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("library_upsert", {
    p_church_id: churchId,
    p_songs: songs,
    p_deleted: deleted,
  });
  if (error) throw error;
  const res = (data ?? {}) as { upserted?: number; deleted?: number };
  return { upserted: res.upserted ?? 0, deleted: res.deleted ?? 0 };
}
