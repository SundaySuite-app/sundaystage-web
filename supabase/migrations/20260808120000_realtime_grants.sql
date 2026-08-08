-- 20260808120000 — Table grants required by Realtime Authorization.
--
-- The 20260621/20260714 policies alone are NOT sufficient: Realtime's
-- private-channel check runs actual SELECT/INSERT probe queries on
-- realtime.messages impersonating the subscriber's role (anon/authenticated),
-- so those roles also need plain table grants for the check to even execute.
-- RLS still applies on top: receive is allowed only via the
-- stage_session_receive SELECT policy, and client sends stay denied
-- (no INSERT policy) — verified live 2026-08-08 (forged ack'd send dropped,
-- server service-role publish delivered).
--
-- Discovered 2026-08-08: with the policy present but these grants missing,
-- every private subscribe failed "Unauthorized: You do not have permissions
-- to read from this Channel topic". The grants were applied manually in prod
-- that day; this migration codifies them so the requirement is reproducible.
--
-- realtime.messages is a Supabase-managed object absent from the vanilla
-- postgres:16 test harness (as are the anon/authenticated roles), so this is
-- guarded and a clean no-op there. Idempotent / safe to re-run.

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (test harness) — skipping realtime grants';
    return;
  end if;

  execute 'grant usage on schema realtime to anon, authenticated';
  execute 'grant select on realtime.messages to anon, authenticated';
end $$;
