-- SundayStage Web — server-assigned `cmd_seq` for remote-control commands
-- (additive to the `stage` schema).
--
-- Lives in the SHARED "Sunday" Supabase project, hence the TIMESTAMP prefix.
-- Idempotent + additive: safe to re-run, touches nothing prior migrations made.
--
-- WHY: the desktop consumer (sundaystage/src/lib/webShare.ts) remembers the
-- highest cmd_seq it has seen for a session and DROPS anything <= it (replay /
-- stale rejection). That counter must therefore be monotonic across operator
-- devices, tabs and reloads — which no client-held counter can guarantee (two
-- phones with skewed clocks, a mid-service reload, a burst inside one ms). So
-- the server assigns it: the same atomic-RPC treatment the frame `seq` already
-- gets from stage.set_frame.
--
-- TRANSITION GUARD — why `greatest(cmd_seq + 1, epoch_ms)` and not a plain
-- `cmd_seq + 1`: the operator build in the field until this ships seeds its
-- cmd_seq from the WALL CLOCK (~1.79e12 today), so desktops already hold
-- timestamp-scale high-water marks for live sessions. A server sequence
-- starting at 1 would sit far below them and every command would be silently
-- dropped — 200 from the API, nothing on the projector, nothing in any log.
-- Flooring the sequence at wall-clock milliseconds keeps every server-assigned
-- value above anything a clock-seeded client can have sent, while `cmd_seq + 1`
-- keeps it STRICTLY increasing when several commands land inside the same
-- millisecond. Both halves are load-bearing — keep both.
-- (Headroom: epoch-ms stays a safe JS integer for ~285 000 years, and the HMAC
-- in lib/commandSig.ts covers the seq as plain decimal text.)

alter table stage.session
  add column if not exists cmd_seq bigint not null default 0;

-- ── RPC ───────────────────────────────────────────────────────────────────────

-- Atomic remote-command counter. Returns the seq the API must sign and
-- broadcast. Raises on unknown/ended/expired sessions with the same errcodes
-- and shape as stage.set_frame, so the route layer can map 404/410.
create or replace function stage.next_cmd_seq(p_id uuid)
returns bigint
language plpgsql
as $$
declare
  v_seq bigint;
begin
  update stage.session
     set cmd_seq = greatest(cmd_seq + 1, (extract(epoch from now()) * 1000)::bigint)
   where id = p_id
     and status = 'live'
     and expires_at > now()
   returning cmd_seq into v_seq;

  if v_seq is null then
    -- Disambiguate for the API layer.
    if not exists (select 1 from stage.session where id = p_id) then
      raise exception 'session_not_found' using errcode = 'P0002';
    else
      raise exception 'session_closed' using errcode = 'P0003';
    end if;
  end if;

  return v_seq;
end;
$$;

-- Service-role-only grants (restated so this migration stands alone).
grant execute on function stage.next_cmd_seq(uuid) to service_role;
