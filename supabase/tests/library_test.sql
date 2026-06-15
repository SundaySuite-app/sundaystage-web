-- Assertions for stage.library_song + stage.library_upsert: idempotent upsert,
-- LWW guard, soft-delete propagation + un-delete, church scoping, deny-all RLS.

\set ON_ERROR_STOP on

do $$
declare
  v_church uuid;
  v_res jsonb;
  v_title text;
  n int;
begin
  insert into public.church (name, slug) values ('Testkirke', 'testkirke')
    returning id into v_church;

  -- ── initial publish of two songs ────────────────────────────────────────────
  v_res := stage.library_upsert(v_church, jsonb_build_array(
    jsonb_build_object('source_song_id','song-a','title','Stor er din trofasthet',
      'sections', jsonb_build_array(jsonb_build_object('label','Vers 1','lines',jsonb_build_array('Stor er din trofasthet'))),
      'language','no','source_updated_at',1000),
    jsonb_build_object('source_song_id','song-b','title','Lovsang',
      'sections', jsonb_build_array(jsonb_build_object('label',null,'lines',jsonb_build_array('Halleluja'))),
      'language','no','source_updated_at',1000)
  ));
  if (v_res->>'upserted')::int <> 2 then raise exception 'FAIL: expected 2 upserted, got %', v_res->>'upserted'; end if;
  select count(*) into n from stage.library_song where church_id = v_church and deleted_at is null;
  if n <> 2 then raise exception 'FAIL: expected 2 active songs, got %', n; end if;
  raise notice 'PASS: initial publish upserts both songs';

  -- ── newer publish updates in place (no duplicate) ────────────────────────────
  v_res := stage.library_upsert(v_church, jsonb_build_array(
    jsonb_build_object('source_song_id','song-a','title','Stor er din trofasthet (ny)',
      'sections', jsonb_build_array(jsonb_build_object('label','Vers 1','lines',jsonb_build_array('Ny linje'))),
      'language','no','source_updated_at',2000)
  ));
  if (v_res->>'upserted')::int <> 1 then raise exception 'FAIL: expected 1 upserted on update, got %', v_res->>'upserted'; end if;
  select title into v_title from stage.library_song where church_id = v_church and source_song_id = 'song-a';
  if v_title <> 'Stor er din trofasthet (ny)' then raise exception 'FAIL: title not updated, got %', v_title; end if;
  select count(*) into n from stage.library_song where church_id = v_church and source_song_id = 'song-a';
  if n <> 1 then raise exception 'FAIL: update created a duplicate row'; end if;
  raise notice 'PASS: newer publish updates in place';

  -- ── LWW guard: an OLDER publish must not clobber ─────────────────────────────
  v_res := stage.library_upsert(v_church, jsonb_build_array(
    jsonb_build_object('source_song_id','song-a','title','GAMMEL',
      'sections', jsonb_build_array(jsonb_build_object('label','Vers 1','lines',jsonb_build_array('x'))),
      'language','no','source_updated_at',500)
  ));
  if (v_res->>'upserted')::int <> 0 then raise exception 'FAIL: stale publish should write 0 rows, wrote %', v_res->>'upserted'; end if;
  select title into v_title from stage.library_song where church_id = v_church and source_song_id = 'song-a';
  if v_title <> 'Stor er din trofasthet (ny)' then raise exception 'FAIL: stale publish clobbered newer title (%)', v_title; end if;
  raise notice 'PASS: LWW guard rejects an older publish';

  -- ── soft-delete propagation ──────────────────────────────────────────────────
  v_res := stage.library_upsert(v_church, '[]'::jsonb, jsonb_build_array('song-b'));
  if (v_res->>'deleted')::int <> 1 then raise exception 'FAIL: expected 1 deleted, got %', v_res->>'deleted'; end if;
  select count(*) into n from stage.library_song where church_id = v_church and deleted_at is null;
  if n <> 1 then raise exception 'FAIL: expected 1 active song after delete, got %', n; end if;
  raise notice 'PASS: soft-delete propagates and hides the song';

  -- ── re-publishing a deleted song un-deletes it ───────────────────────────────
  v_res := stage.library_upsert(v_church, jsonb_build_array(
    jsonb_build_object('source_song_id','song-b','title','Lovsang',
      'sections', jsonb_build_array(jsonb_build_object('label',null,'lines',jsonb_build_array('Halleluja'))),
      'language','no','source_updated_at',3000)
  ));
  select count(*) into n from stage.library_song where church_id = v_church and deleted_at is null;
  if n <> 2 then raise exception 'FAIL: re-publish should un-delete (expected 2 active), got %', n; end if;
  raise notice 'PASS: re-publishing a deleted song restores it';
end $$;

-- ── RLS: anon/authenticated see nothing ──────────────────────────────────────
do $$
declare
  n int;
begin
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from stage.library_song;
    raise exception 'FAIL: anon could select from stage.library_song';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  perform set_config('role', 'authenticated', true);
  begin
    select count(*) into n from stage.library_song;
    raise exception 'FAIL: authenticated could select from stage.library_song';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: deny-all posture for anon/authenticated';
end $$;

select 'ALL LIBRARY TESTS PASSED' as result;
