# CLAUDE.md — SundayStage Web

The web companion to the SundayStage desktop app: **show songs over the
network with low latency**. Lives at https://stage.sundaysuite.app on a
Cloudflare Worker (OpenNext). Lighter than desktop by design — desktop owns
the real editor, themes, AI formatter and the projector pipeline; the web app
owns *reach*: any browser becomes a display.

## What it does

- **Display** `/d/<code>` — fullscreen slide view for projector PCs, TVs,
  spare laptops. Joins with a 6-digit code.
- **Follow** `/f/<code>` — text-only follow-along on phones in the pew
  (accessibility). Replaces the desktop repo's old static companion PWA.
- **Web operator** `/new` → `/o/<id>` — paste lyrics, get slides, run a simple
  service from a phone/laptop without the desktop app. Also remote-controls a
  desktop-driven session (next/prev/black/logo).
- **Desktop share** — the desktop app's "Del over nettverk" creates a session
  here and POSTs every live frame; web displays render it.

## Architecture (the quiz pattern, proven in prod)

- **Supabase broadcast, not postgres_changes**: server-side REST publish to
  `/realtime/v1/api/broadcast` (lib/server/broadcast.ts), browser subscribes
  with supabase-js (lib/client/useChannel.ts). 300–600 ms typical end-to-end.
- **Server-assigned `seq`** via an atomic RPC; broadcast AND polling flow
  through the same newer-wins reducer (lib/merge.ts) so stale never overwrites
  fresh. Polling (15 s healthy / 3 s while disconnected) is the safety net —
  broadcast failures are swallowed by design.
- **One write path**: desktop forwarder and web operator both POST
  `/api/sessions/[id]/frame` with the session's bearer secret. The secret is
  returned exactly once, at session creation.
- **WebFrame** (lib/webframe.ts) is the versioned renderable payload —
  app-internal, NOT the canonical LiveEvent (that's a signal contract).
  Sensitive slides are gated SENDER-side to a neutral placeholder; private
  content never leaves the building.
- **DB**: `stage` schema on the shared "Sunday" Supabase project
  (rkiahljrkormwzogghpc — SundayPlan owns `public`, SundayInfo owns `info`).
  RLS deny-all; every read/write goes through API routes with the service
  role. Migrations use TIMESTAMP version prefixes (shared-project rule).
  Sessions expire after 24 h; cleanup runs lazily on session creation.

## Conventions

- `npm run check` = tsc + eslint + vitest — must be green before commit.
- `scripts/test-db.sh` = Docker Postgres migration + RLS/RPC assertions.
- `scripts/smoke.mjs` = full session lifecycle against a running server
  (`BASE=https://stage.sundaysuite.app node scripts/smoke.mjs`).
- `scripts/latency.mjs` = measures POST→broadcast p95; must stay < 1 s.
- Dark-first; Sunday Gold (#D4A73A) on chrome only — the slide surface stays
  neutral. Norwegian-first UI, 7 locales (no/en/sv/da/de/fr/pl).

## Deploy

```
set -a && source .env.production.local && set +a
npm run cf:build && npx opennextjs-cloudflare deploy
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # once
```
