-- SundayStage Web — per-pew translation cache (additive to the `stage` schema).
--
-- Lives in the SHARED "Sunday" Supabase project, hence the TIMESTAMP prefix.
-- Idempotent + additive: safe to re-run, touches nothing the base migration
-- created. Same deny-all RLS posture — only the service role (API routes)
-- reads/writes; followers never touch this table directly.
--
-- Cost model: each (session, slide-content hash, target language) is translated
-- by Claude exactly ONCE and stored here; every phone after that reads the
-- cached row. Rows die with the session (FK ON DELETE CASCADE), so the lazy
-- janitor that prunes expired sessions cleans these up for free.

create table if not exists stage.translation (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references stage.session (id) on delete cascade,
  frame_hash    text not null check (frame_hash ~ '^[0-9a-f]{64}$'),  -- sha-256 hex
  target_lang   text not null check (target_lang in ('no','en','sv','da','de','fr','pl')),
  text_lines    jsonb not null,
  section_label text,
  created_at    timestamptz not null default now()
);

-- Idempotent dedup key: one cached translation per slide-content per language
-- per session. The route's upsert ON CONFLICT DO NOTHING rides this.
create unique index if not exists translation_uq
  on stage.translation (session_id, frame_hash, target_lang);

-- Lookups are always (session, hash, lang) — the unique index already serves
-- them. A session-scoped index helps cascade deletes stay cheap.
create index if not exists translation_session_idx
  on stage.translation (session_id);

alter table stage.translation enable row level security;

-- Service-role-only grants (re-runs of the base migration's grant-all also
-- cover this table; restated here so this migration stands alone).
grant all on stage.translation to service_role;
