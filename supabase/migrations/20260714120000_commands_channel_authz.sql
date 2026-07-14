-- 20260714120000 — Harden the remote-control (:commands) channel to PRIVATE.
--
-- Background: 20260621120000_realtime_authz.sql made the FRAME channel
-- (stage:session:<id>) private but deliberately left :commands PUBLIC to avoid
-- a lockstep change in the desktop repo. On a public channel any anon client
-- that learns the session UUID can `.send()` a forged `command` broadcast; the
-- desktop app (src/lib/webShare.ts) consumes it and, on a higher cmd_seq, acts
-- on it → hijacking slide control (next/prev/black/logo/clear) during a live
-- service. Same class of hole as the frame hijack, hitting the desktop consumer.
--
-- Fix (coordinated with the desktop repo, branch feat/rt-hardening-coordinated):
--   * Desktop subscribes to :commands with `config.private = true`.
--   * The web /command route sends with `{ private: true }` (RLS-authorized) and,
--     during the fleet-upgrade window, ALSO a public copy so older desktop builds
--     still receive commands (dual-send bridge; dropped once the fleet upgrades).
--
-- The receive (SELECT) authorization is already granted by the wildcard policy
-- from 20260621120000: `realtime.topic() like 'stage:session:%'` matches
-- stage:session:<id>:commands. This migration re-asserts that policy so the
-- commands-channel hardening is self-contained and safe to apply even if run out
-- of order. As before: NO client insert/update/delete policy → a forged anon
-- `.send()` is denied by default-deny RLS; the server publish bypasses RLS via
-- the service_role key.
--
-- realtime.messages is a Supabase-managed object absent from the vanilla
-- postgres:16 test harness, so the policy is guarded on its presence and is a
-- clean no-op there. Idempotent / safe to re-run.

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (test harness) — skipping commands-channel RLS policy';
    return;
  end if;

  -- RECEIVE: anon/authenticated may read realtime.messages for any
  -- stage:session:* topic (frame, :commands and :presence share this wildcard).
  execute 'drop policy if exists "stage_session_receive" on realtime.messages';
  execute $p$
    create policy "stage_session_receive"
      on realtime.messages
      for select
      to anon, authenticated
      using ( realtime.topic() like 'stage:session:%' )
  $p$;

  -- Still NO insert/update/delete policy for anon/authenticated → forged client
  -- broadcasts (spoofed commands or frames) are denied. Server publish bypasses
  -- RLS via service_role.
end $$;
