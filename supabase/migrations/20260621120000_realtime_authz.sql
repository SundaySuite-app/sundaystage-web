-- 20260621120000 — Realtime Authorization for the stage:session:* broadcast topics.
--
-- Today the frame channel (stage:session:<id>) is PUBLIC: anyone who learns the
-- session UUID (the public by-code join returns it) can subscribe AND .send()
-- forged broadcast frames, which lib/merge.ts applyEnvelope accepts on any higher
-- seq → hijacking every display until the next authoritative poll.
--
-- Fix: the client marks the frame channel `private: true` (lib/client/useChannel.ts),
-- which makes Realtime authorize every subscriber against RLS on realtime.messages.
-- This policy lets anon + authenticated RECEIVE (SELECT) on stage:session:* topics
-- but grants NO client INSERT → a forged client .send() is denied by default-deny.
-- Server publish is unaffected: lib/server/broadcast.ts uses the service_role key,
-- which bypasses RLS.
--
-- Scope note: only the FRAME channel goes private here. The :commands channel
-- (consumed by the separate desktop app) and :presence (track() writes a viewer
-- count) stay public to avoid a lockstep cross-repo change; the wildcard SELECT
-- below harmlessly also covers their receive side.
--
-- realtime.messages is a Supabase-managed object absent from the vanilla
-- postgres:16 test harness, so the policy is guarded on its presence and is a
-- clean no-op there (scripts/smoke.mjs verifies the live behavior instead).
-- Idempotent / safe to re-run.

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (test harness) — skipping Realtime RLS policy';
    return;
  end if;

  -- RECEIVE: a private-channel subscriber reads realtime.messages for its topic.
  -- realtime.topic() returns the topic being authorized; the % wildcard covers
  -- stage:session:<id>, :commands and :presence for the SELECT (receive) side.
  execute 'drop policy if exists "stage_session_receive" on realtime.messages';
  execute $p$
    create policy "stage_session_receive"
      on realtime.messages
      for select
      to anon, authenticated
      using ( realtime.topic() like 'stage:session:%' )
  $p$;

  -- NO insert/update/delete policy for anon/authenticated → client broadcasts
  -- (forged frames) are denied by default-deny RLS. Server publish bypasses RLS
  -- via service_role.
end $$;
