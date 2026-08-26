# Sprint 0 Handoff — Discovery, Foundation & Offline Contract

## Status

`in progress` — technical foundation and ADRs are complete and verified; two items require the human owner (real user interviews, Coolify staging deploy) before this sprint can be marked `complete`.

## Scope delivered

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 app scaffold, merged into the existing `app/`, `components/`, `lib/`, `tests/`, `docs/` folder contract from `docs/architecture.md` (no folder-ownership boundaries violated).
- PWA shell: `app/manifest.ts` (installable web app manifest), `app/sw.ts` service worker built via `@serwist/next` (Workbox-based, per the locked stack), registered automatically at build time.
- Visible sync-state component: `components/features/sync/sync-status-indicator.tsx` (browser online/offline only for now) rendered on `components/ui/status-badge.tsx`, shown on the home page.
- `lib/sync/operation-id.ts` — the client-generated `operation_id` primitive from ADR 0003, with unit tests.
- `lib/db/client.ts`, `drizzle.config.ts`, `lib/db/schema.ts` (empty placeholder) — Drizzle wired to a Postgres `DATABASE_URL`; no tables yet (Sprint 1 owns schema).
- Minimal, no-op-unless-configured observability wiring: `lib/observability/sentry.ts`, `lib/observability/posthog.ts`, invoked from `components/features/observability/observability-init.tsx` in the root layout. Full alerting/dashboards are follow-up work, not required for Sprint 0.
- CI: `.github/workflows/ci.yml` runs lint, typecheck, unit tests, Playwright E2E and production build on push/PR.
- `docs/adr/0001-self-hosted-coolify-data-platform.md` — hosting/data-platform decision (Coolify + self-hosted Supabase stack, superseding the original Vercel/managed-Supabase plan; owner-approved 2026-08-26).
- `docs/adr/0002-powersync-local-first-sync.md`, `docs/adr/0003-operation-idempotency-contract.md`, `docs/adr/0004-currency-snapshot-model.md`.
- `docs/discovery.md` — drafted as unvalidated hypotheses, explicitly labeled as such (see Blockers below).
- `project_description.md`, `docs/architecture.md`, `sprints.md` updated to remove Vercel/managed-Supabase references per ADR 0001.

## Acceptance evidence

| Criterion | Evidence location / command | Result |
|---|---|---|
| `docs/discovery.md` identifies launch users, pains, pricing hypotheses, risks | `docs/discovery.md` | Drafted as **hypotheses only** — real 10–15 user interviews not yet conducted. See Blockers. |
| `docs/adr/` contains sync, idempotency and currency decisions | `docs/adr/0002-*.md`, `0003-*.md`, `0004-*.md` (plus `0001-*.md` for the hosting change this sprint required) | Done |
| A fresh clone can run locally using README instructions and `.env.example` | `README.md` "Local development" section; `npm install && npm run dev` verified working in this session | Done, with one caveat: `.env.example` was **not updated** with the new variable names (DATABASE_URL, Sentry, PostHog, Africa's Talking) — the sandboxed environment denies file access to `.env*` files for this assistant. See Blockers. |
| CI runs lint, typecheck, unit test, E2E smoke test and production build | `.github/workflows/ci.yml`; commands run locally this session (see Verification run below) | Done locally; CI has not yet run on GitHub (no push performed as part of this handoff) |
| Staging shows the installable PWA shell and sync status | — | **Not done.** No Coolify staging resource has been created yet — provisioning real infrastructure on the owner's paid server requires explicit confirmation before I act, per this assistant's operating rules. See Blockers. |

## Verification run

```text
Command: npm run lint
Result: pass, 0 errors/warnings
Date: 2026-08-26

Command: npm run typecheck
Result: pass
Date: 2026-08-26

Command: npm run test
Result: pass — 1 file, 3 tests (tests/unit/operation-id.test.ts)
Date: 2026-08-26

Command: npm run test:e2e
Result: pass — 2 tests (tests/e2e/pwa-shell.spec.ts), Chromium
Date: 2026-08-26

Command: npm run build
Result: pass — static build of /, /_not-found, /manifest.webmanifest; service worker bundled
Date: 2026-08-26
```

Note: `next build`/`next dev` are pinned to `--webpack` in `package.json` scripts because `@serwist/next`'s build-time service worker bundling does not yet support Next 16's default Turbopack builder (tracked upstream at serwist/serwist#54). Revisit this pin if `@serwist/turbopack` stabilizes.

`npm audit` reports one remaining moderate-severity advisory in `drizzle-kit`'s transitive `esbuild` dependency (dev-time only — allows a malicious site to read `next dev`'s local dev-server responses; does not affect production builds or runtime). Fixing it requires downgrading `drizzle-kit` to 0.18.1, which is older and a breaking change; left as-is and flagged here rather than silently accepted. The higher-severity `drizzle-orm` SQL-identifier-escaping advisory was fixed by pinning `drizzle-orm@^0.45.2`.

## Changed surfaces

- Migrations: none (no schema tables yet).
- Environment variables **needed** (not yet added to `.env.example` — see Blockers): `DATABASE_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, and (for a later sprint, but worth reserving names now) `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`.
- Routes/components: `app/layout.tsx`, `app/page.tsx`, `app/manifest.ts`, `app/sw.ts`, `components/ui/status-badge.tsx`, `components/features/sync/sync-status-indicator.tsx`, `components/features/observability/observability-init.tsx`.
- Services/integrations: `lib/db/client.ts` (Drizzle/Postgres), `lib/sync/operation-id.ts`, `lib/observability/sentry.ts`, `lib/observability/posthog.ts`.

## Decisions and limitations

- ADRs created/updated: 0001 (hosting/data platform — Coolify + self-hosted Supabase, Africa's Talking confirmed as GoTrue's SMS/OTP provider), 0002 (PowerSync, self-hosted edition), 0003 (operation_id/device_id idempotency contract), 0004 (currency snapshot model).
- Known limitations: sync-status component only reflects `navigator.onLine`, not real PowerSync queue/sync/conflict state (that lands with PowerSync wiring starting Sprint 2, per ADR 0002). No database schema exists yet. Observability wiring is minimal (no-op without real DSN/keys) and untested against a real Sentry/PostHog project.
- Blockers requiring a human/provider decision:
  1. **Real discovery interviews** (10–15 target users) have not been conducted; `docs/discovery.md` is hypotheses only. This is a relationship/field-research task outside what an AI assistant can perform.
  2. **`.env.example` could not be updated by this assistant** — the sandbox denies Read/Edit/Bash access to `.env*` files. The owner (or a session with different sandbox permissions) needs to add the variable names listed above.
  3. **Coolify staging deployment** has not been performed. This assistant has API access details for the owner's Coolify server (`../../coolify-infra/README.md`) but did not create any resources without explicit confirmation, since provisioning real infrastructure on a paid server is a consequential, real-world action. Needs an explicit go-ahead to: create a Coolify project for StockFlow ZW, deploy the self-hosted Supabase stack (Postgres/GoTrue/PostgREST/Storage/Realtime) and the Next.js app as separate resources per ADR 0001, and wire CI to deploy there.

## Next assistant

- Next permitted sprint: Sprint 0 is not yet exit-gated (see blockers above) — do not start Sprint 1 until: (a) the owner decides how to handle the discovery-interview gap (real interviews vs. explicitly accepting the hypothesis-only version), and (b) a Coolify staging environment exists and shows the PWA shell + sync status live.
- First files to read: this file, `docs/discovery.md`, `docs/adr/0001-*.md` through `0004-*.md`, `docs/architecture.md`.
- Do not do yet: any product/stock/POS schema, payment integration, or WhatsApp/AI work (per `CLAUDE.md`'s "First task" instruction) — and do not silently mark Sprint 0's checkboxes in `sprints.md` complete until the two blockers above are resolved.
