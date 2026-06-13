-- Assertions for the stage schema: seq/stale/closed semantics, PIN
-- uniqueness, cleanup, and the deny-all RLS posture.

\set ON_ERROR_STOP on

do $$
declare
  v_id uuid;
  v_other uuid;
  v_seq bigint;
  n int;
begin
  -- ── set_frame: monotonic seq + stale guard ──────────────────────────────────
  insert into stage.session (code, secret_hash, origin)
    values ('123456', 'hash-a', 'desktop') returning id into v_id;

  v_seq := stage.set_frame(v_id, '{"v":1,"kind":"black"}'::jsonb, 1);
  if v_seq <> 1 then raise exception 'FAIL: first seq should be 1, got %', v_seq; end if;
  v_seq := stage.set_frame(v_id, '{"v":1,"kind":"logo"}'::jsonb, 2);
  if v_seq <> 2 then raise exception 'FAIL: second seq should be 2, got %', v_seq; end if;

  -- Stale client_seq (2 again) must raise P0004.
  begin
    perform stage.set_frame(v_id, '{"v":1,"kind":"black"}'::jsonb, 2);
    raise exception 'FAIL: stale client_seq accepted';
  exception when sqlstate 'P0004' then null;
  end;

  -- Null client_seq (web operator without counter) is always accepted.
  v_seq := stage.set_frame(v_id, '{"v":1,"kind":"black"}'::jsonb, null);
  if v_seq <> 3 then raise exception 'FAIL: null client_seq should advance seq'; end if;
  raise notice 'PASS: set_frame seq monotonic + stale guard';

  -- ── closed sessions ────────────────────────────────────────────────────────
  update stage.session set status = 'ended', ended_at = now() where id = v_id;
  begin
    perform stage.set_frame(v_id, '{"v":1,"kind":"black"}'::jsonb, 10);
    raise exception 'FAIL: ended session accepted a frame';
  exception when sqlstate 'P0003' then null;
  end;

  begin
    perform stage.set_frame(gen_random_uuid(), '{"v":1,"kind":"black"}'::jsonb, 1);
    raise exception 'FAIL: unknown session accepted a frame';
  exception when sqlstate 'P0002' then null;
  end;
  raise notice 'PASS: closed/unknown sessions refuse frames';

  -- ── PIN uniqueness among LIVE sessions only ────────────────────────────────
  insert into stage.session (code, secret_hash, origin)
    values ('123456', 'hash-b', 'web') returning id into v_other; -- ok: first is ended
  begin
    insert into stage.session (code, secret_hash, origin) values ('123456', 'hash-c', 'web');
    raise exception 'FAIL: duplicate LIVE pin accepted';
  exception when unique_violation then null;
  end;
  raise notice 'PASS: PIN unique among live sessions, reusable after end';

  -- ── expiry + cleanup ───────────────────────────────────────────────────────
  update stage.session set expires_at = now() - interval '1 minute' where id = v_other;
  begin
    perform stage.set_frame(v_other, '{"v":1,"kind":"black"}'::jsonb, 1);
    raise exception 'FAIL: expired session accepted a frame';
  exception when sqlstate 'P0003' then null;
  end;

  n := stage.cleanup();
  if n < 1 then raise exception 'FAIL: cleanup deleted nothing'; end if;
  if exists (select 1 from stage.session where id = v_other) then
    raise exception 'FAIL: expired session survived cleanup';
  end if;
  raise notice 'PASS: expiry blocks writes and cleanup removes the row';
end $$;

-- ── RLS: anon/authenticated see nothing, can write nothing ───────────────────
do $$
declare
  n int;
begin
  insert into stage.session (code, secret_hash, origin) values ('654321', 'h', 'web');

  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from stage.session;
    raise exception 'FAIL: anon could select from stage.session';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  perform set_config('role', 'authenticated', true);
  begin
    select count(*) into n from stage.session;
    raise exception 'FAIL: authenticated could select from stage.session';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: deny-all posture for anon/authenticated';
end $$;

select 'ALL STAGE-LOGIC TESTS PASSED' as result;
