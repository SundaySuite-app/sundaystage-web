-- SundayStage Web — `stage` schema (network display sessions).
--
-- Lives in the SHARED "Sunday" Supabase project (SundayPlan owns `public`,
-- SundayInfo owns `info`), hence the TIMESTAMP version prefix. Idempotent:
-- safe to re-run.
--
-- Security model (suite convention for the web apps): RLS enabled on every
-- table with ZERO policies — no anon/authenticated table access at all. Every
-- read/write goes through Next API routes using the service role; displays
-- and operators authenticate with a per-session bearer secret (hash stored
-- here, raw secret returned exactly once at creation).

create extension if not exists pgcrypto;

create schema if not exists stage;

-- Explicit grants: a non-public schema gets nothing by default (the
-- harvest/market lesson). Only service_role may touch it.
grant usage on schema stage to service_role;

create table if not exists stage.session (
  id            uuid primary key default gen_random_uuid(),
  code          text not null check (code ~ '^[0-9]{6}$'),
  secret_hash   text not null,
  origin        text not null check (origin in ('desktop','web')),
  church_id     uuid,                 -- provenance only (stamped when signed in)
  title         text not null default '',
  status        text not null default 'live' check (status in ('live','ended')),
  current_frame jsonb,
  current_seq   bigint not null default 0,
  client_seq    bigint,               -- last accepted sender counter (stale guard)
  setlist       jsonb,                -- web-operator sessions: resume after refresh
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',
  ended_at      timestamptz
);

-- A PIN is reusable over time but unique among LIVE sessions.
create unique index if not exists session_active_code_uq
  on stage.session (code) where status = 'live';
create index if not exists session_expires_idx on stage.session (expires_at);

alter table stage.session enable row level security;

-- ── RPCs ──────────────────────────────────────────────────────────────────────

-- Atomic frame write: server-assigned monotonic seq + sender stale-guard.
-- Returns the new seq. Raises on ended/expired sessions and on stale
-- client_seq so HTTP reordering can never publish an older frame.
create or replace function stage.set_frame(
  p_id uuid,
  p_frame jsonb,
  p_client_seq bigint default null
) returns bigint
language plpgsql
as $$
declare
  v_seq bigint;
begin
  update stage.session
     set current_frame = p_frame,
         current_seq   = current_seq + 1,
         client_seq    = coalesce(p_client_seq, client_seq)
   where id = p_id
     and status = 'live'
     and expires_at > now()
     and (p_client_seq is null or client_seq is null or p_client_seq > client_seq)
   returning current_seq into v_seq;

  if v_seq is null then
    -- Disambiguate for the API layer.
    if not exists (select 1 from stage.session where id = p_id) then
      raise exception 'session_not_found' using errcode = 'P0002';
    elsif exists (
      select 1 from stage.session
       where id = p_id and (status <> 'live' or expires_at <= now())
    ) then
      raise exception 'session_closed' using errcode = 'P0003';
    else
      raise exception 'stale_client_seq' using errcode = 'P0004';
    end if;
  end if;

  return v_seq;
end;
$$;

-- Lazy janitor: called from the create-session route. Deletes expired rows.
create or replace function stage.cleanup() returns int
language sql
as $$
  with gone as (
    delete from stage.session where expires_at < now() returning 1
  )
  select count(*)::int from gone;
$$;

-- Service-role needs the lot; nothing for anon/authenticated.
grant all on all tables in schema stage to service_role;
grant all on all sequences in schema stage to service_role;
grant execute on all functions in schema stage to service_role;
alter default privileges in schema stage grant all on tables to service_role;
alter default privileges in schema stage grant all on sequences to service_role;
alter default privileges in schema stage grant execute on functions to service_role;
