-- Assertions for stage.translation: idempotent cache key, language check,
-- session cascade, and the deny-all RLS posture.

\set ON_ERROR_STOP on

do $$
declare
  v_sid uuid;
  v_hash text := repeat('a', 64);
  n int;
begin
  insert into stage.session (code, secret_hash, origin)
    values ('700001', 'h', 'web') returning id into v_sid;

  -- ── idempotent upsert: one row per (session, hash, lang) ─────────────────────
  insert into stage.translation (session_id, frame_hash, target_lang, text_lines, section_label)
    values (v_sid, v_hash, 'en', '["Great is thy faithfulness"]'::jsonb, 'Verse 1');

  -- ON CONFLICT DO NOTHING must collapse a racing second writer.
  insert into stage.translation (session_id, frame_hash, target_lang, text_lines, section_label)
    values (v_sid, v_hash, 'en', '["different text but same key"]'::jsonb, null)
    on conflict (session_id, frame_hash, target_lang) do nothing;

  select count(*) into n from stage.translation
    where session_id = v_sid and frame_hash = v_hash and target_lang = 'en';
  if n <> 1 then raise exception 'FAIL: duplicate cache key created % rows', n; end if;

  -- A different language for the same slide is a distinct row (paid separately).
  insert into stage.translation (session_id, frame_hash, target_lang, text_lines)
    values (v_sid, v_hash, 'de', '["Groß ist deine Treue"]'::jsonb);
  select count(*) into n from stage.translation where session_id = v_sid;
  if n <> 2 then raise exception 'FAIL: per-language rows wrong, got %', n; end if;
  raise notice 'PASS: cache key idempotent + per-language';

  -- ── target_lang is constrained to the 7 supported locales ────────────────────
  begin
    insert into stage.translation (session_id, frame_hash, target_lang, text_lines)
      values (v_sid, v_hash, 'es', '["x"]'::jsonb);
    raise exception 'FAIL: unsupported target_lang accepted';
  exception when check_violation then null;
  end;

  -- ── frame_hash must look like a sha-256 hex digest ───────────────────────────
  begin
    insert into stage.translation (session_id, frame_hash, target_lang, text_lines)
      values (v_sid, 'not-a-hash', 'en', '["x"]'::jsonb);
    raise exception 'FAIL: malformed frame_hash accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: target_lang + frame_hash constraints enforced';

  -- ── deleting the session cascades the cache away ─────────────────────────────
  delete from stage.session where id = v_sid;
  select count(*) into n from stage.translation where session_id = v_sid;
  if n <> 0 then raise exception 'FAIL: translation rows survived session delete'; end if;
  raise notice 'PASS: translation rows cascade with the session';
end $$;

-- ── RLS: anon/authenticated see nothing ──────────────────────────────────────
do $$
declare
  n int;
begin
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from stage.translation;
    raise exception 'FAIL: anon could select from stage.translation';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  perform set_config('role', 'authenticated', true);
  begin
    select count(*) into n from stage.translation;
    raise exception 'FAIL: authenticated could select from stage.translation';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: deny-all posture for anon/authenticated on translation';
end $$;

select 'ALL TRANSLATION TESTS PASSED' as result;
