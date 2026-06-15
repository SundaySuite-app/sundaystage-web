-- SundayStage Web — shared church song library (additive to the `stage` schema).
--
-- Lives in the SHARED "Sunday" Supabase project, hence the TIMESTAMP prefix.
-- Idempotent + additive: safe to re-run, touches nothing prior migrations made.
--
-- Purpose: the desktop app publishes its local song library here (ONE-WAY,
-- desktop → cloud), scoped to a church. The web operator, when signed in to the
-- same church (Sunday SSO), can pick songs into a session. Web is a read
-- consumer, so the desktop's relational graph (Song/Section/Arrangement) is
-- DENORMALISED to `sections` JSONB in the exact SlideDef shape the operator
-- already renders ([{label, lines:[...]}]) — no transform on the web side.
--
-- Security: same deny-all RLS posture as the rest of `stage` — RLS enabled,
-- ZERO policies, only the service role touches it. Church isolation is enforced
-- in the API layer from a JWKS-verified Sunday token (the `church_id` is taken
-- from token claims, never from the request body), mirroring SundaySong.

create table if not exists stage.library_song (
  id                uuid primary key default gen_random_uuid(),
  church_id         uuid not null references public.church (id) on delete cascade,
  source_song_id    text not null,            -- desktop UUIDv7 — idempotent upsert key
  title             text not null,
  sections          jsonb not null,           -- [{label, lines:[...]}] (SlideDef shape)
  arrangement       jsonb,                    -- optional ordered section labels
  ccli_song_id      text,
  tono_work_id      text,
  copyright_notice  text,
  language          text not null default 'no',
  default_key       text,
  source_updated_at bigint not null,          -- desktop song.updated_at (unix ms) — LWW
  deleted_at        timestamptz,              -- soft-delete propagation
  published_by      uuid,                     -- claims.sub (provenance only)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (church_id, source_song_id)          -- one row per desktop song per church
);

-- The only hot query: "active songs for this church", alphabetised.
create index if not exists library_song_church_idx
  on stage.library_song (church_id) where deleted_at is null;

alter table stage.library_song enable row level security;

-- ── RPC: idempotent batch publish (upsert + soft-delete), LWW-guarded ────────────
-- The API resolves `p_church_id` from the verified token and passes it in; every
-- row is stamped with it, so a publish can only ever write the caller's church.
-- LWW: an incoming song updates an existing row only when its source_updated_at
-- is >= the stored one, so an older desktop client can never clobber a newer
-- publish (the `services/sync.rs::last_write_wins_keeps_local` discipline).
-- Re-publishing a song un-deletes it; `p_deleted` (source_song_ids) wins as a
-- tombstone (delete supersedes edits, per `coalesce_outbox`). Returns counts.
create or replace function stage.library_upsert(
  p_church_id uuid,
  p_songs jsonb,
  p_deleted jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_song jsonb;
  v_rc int;
  v_upserted int := 0;
  v_deleted int := 0;
begin
  for v_song in select * from jsonb_array_elements(coalesce(p_songs, '[]'::jsonb))
  loop
    insert into stage.library_song (
      church_id, source_song_id, title, sections, arrangement,
      ccli_song_id, tono_work_id, copyright_notice, language, default_key,
      source_updated_at, published_by, updated_at, deleted_at
    )
    values (
      p_church_id,
      v_song ->> 'source_song_id',
      coalesce(v_song ->> 'title', ''),
      coalesce(v_song -> 'sections', '[]'::jsonb),
      v_song -> 'arrangement',
      v_song ->> 'ccli_song_id',
      v_song ->> 'tono_work_id',
      v_song ->> 'copyright_notice',
      coalesce(v_song ->> 'language', 'no'),
      v_song ->> 'default_key',
      coalesce((v_song ->> 'source_updated_at')::bigint, 0),
      nullif(v_song ->> 'published_by', '')::uuid,
      now(),
      null
    )
    on conflict (church_id, source_song_id) do update
      set title             = excluded.title,
          sections          = excluded.sections,
          arrangement       = excluded.arrangement,
          ccli_song_id      = excluded.ccli_song_id,
          tono_work_id      = excluded.tono_work_id,
          copyright_notice  = excluded.copyright_notice,
          language          = excluded.language,
          default_key       = excluded.default_key,
          source_updated_at = excluded.source_updated_at,
          published_by      = excluded.published_by,
          updated_at        = now(),
          deleted_at        = null
      where excluded.source_updated_at >= stage.library_song.source_updated_at;
    get diagnostics v_rc = row_count;
    v_upserted := v_upserted + v_rc;
  end loop;

  if jsonb_array_length(coalesce(p_deleted, '[]'::jsonb)) > 0 then
    update stage.library_song
       set deleted_at = now(), updated_at = now()
     where church_id = p_church_id
       and deleted_at is null
       and source_song_id in (select jsonb_array_elements_text(p_deleted));
    get diagnostics v_deleted = row_count;
  end if;

  return jsonb_build_object('upserted', v_upserted, 'deleted', v_deleted);
end;
$$;

-- Service-role-only grants (restated so this migration stands alone).
grant all on stage.library_song to service_role;
grant execute on function stage.library_upsert(uuid, jsonb, jsonb) to service_role;
