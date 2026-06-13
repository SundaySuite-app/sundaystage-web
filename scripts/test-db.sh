#!/usr/bin/env bash
# Validate the stage migration + logic against a throwaway Postgres. Requires
# Docker. Applies the migration TWICE (idempotency proof), then runs the
# seq/stale/RLS assertions. Same harness as the sibling Sunday web apps.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=stageweb-pgtest
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

run() {
  docker cp "$1" "$NAME:/tmp/$(basename "$1")" >/dev/null
  docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$(basename "$1")"
}

echo "→ prelude (Supabase shims)"
run supabase/tests/_prelude.sql
MIG=supabase/migrations/20260613040000_stage_schema.sql
TRMIG=supabase/migrations/20260613120000_translation_cache.sql
echo "→ migration (1st apply)"
run "$MIG"
run "$TRMIG"
echo "→ migration (2nd apply — idempotency)"
run "$MIG"
run "$TRMIG"

echo "→ stage-logic assertions"
docker cp supabase/tests/stage_logic_test.sql "$NAME:/tmp/t.sql" >/dev/null
OUT=$(docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql 2>&1) || true
echo "$OUT" | grep -E "PASS|FAIL" || true
echo "$OUT" | grep -q "ALL STAGE-LOGIC TESTS PASSED" || { echo "TESTS FAILED"; echo "$OUT" | tail -25; exit 1; }

echo "→ translation-cache assertions"
docker cp supabase/tests/translation_test.sql "$NAME:/tmp/tr.sql" >/dev/null
OUT=$(docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/tr.sql 2>&1) || true
echo "$OUT" | grep -E "PASS|FAIL" || true
echo "$OUT" | grep -q "ALL TRANSLATION TESTS PASSED" || { echo "TESTS FAILED"; echo "$OUT" | tail -25; exit 1; }
echo "✓ all database checks passed"
