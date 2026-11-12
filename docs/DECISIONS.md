# Decisions

Lightweight ADRs. Newest first.

---

## ADR-001 — TypeScript 7 via side-om-side-oppsettet (`@typescript/native` + `typescript` som TS 6-API)

- **Date:** 2026-11-12
- **Status:** accepted
- **Context:**

  TypeScript 7 er den native (Go) kompilatoren. typescript-eslint (via
  `eslint-config-next`) kaster ved import på TS >= 7
  (`typescript-eslint does not support TS 7.0`, typescript-eslint#10940), og Next 16
  type-sjekker bygget ved å starte `bin.tsc` fra pakken som svarer til navnet
  `typescript` (`experimental.useTypeScriptCli`, default `true`).

- **Decision:**

  Samme oppsett som sundayquiz (ADR-001 i
  https://github.com/richardfossland/sundayquiz/blob/main/docs/DECISIONS.md,
  innført i sundayquiz#29), to npm-alias i stedet for én avhengighet:

  ```json
  "@typescript/native": "npm:typescript@~7.0.2",
  "typescript":         "npm:@typescript/typescript6@^6.0.2"
  ```

  `node_modules/.bin/tsc` er TS 7 (brukes av `npm run typecheck` og CI), mens
  `require("typescript")` er TS 6-API-et som typescript-eslint og Next bruker.
  Fordi TS 6-kompatpakken ikke har `bin.tsc`, settes også
  `experimental.useTypeScriptCli: false` i `next.config.ts`, slik at Next bruker
  sin in-process API-typesjekker.

- **Consequences:**

  - Linjen `"typescript": "npm:@typescript/typescript6@..."` er **ikke** en
    nedgradering. Ikke «fiks» den tilbake til `"typescript": "^7"` — da knekker `npm run lint`.
  - `experimental.useTypeScriptCli: false` er lastbærende: fjernes den, feiler
    `next build` med «you do not have the required package(s) installed».
  - Typesjekk skjer to ganger: `npm run typecheck` med TS 7 (autoritativ), og
    `next build` med TS 6-API-et.
  - Gå tilbake til én `"typescript": "^7"` og default `useTypeScriptCli` når
    typescript-eslint støtter TS >= 7.1 (typescript-eslint#10940).

---
