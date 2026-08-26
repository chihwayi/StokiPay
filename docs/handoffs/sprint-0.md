# Sprint 0 Handoff — Discovery, Foundation & Offline Contract

## Status

`in progress` — technical foundation, ADRs and Coolify staging (Next.js app + self-hosted Supabase stack) are live and verified. Three items remain blocked on the human owner or external providers before this sprint can be marked `complete` — see Blockers.

## Scope delivered

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 app scaffold, merged into the existing `app/`, `components/`, `lib/`, `tests/`, `docs/` folder contract from `docs/architecture.md`.
- PWA shell: `app/manifest.ts`, `app/sw.ts` service worker via `@serwist/next` (Workbox-based), registered automatically at build time.
- Visible sync-state component: `components/features/sync/sync-status-indicator.tsx` (browser online/offline only for now).
- `app/api/health/route.ts` — liveness endpoint used by the Coolify health check, returns `{"status":"ok"}` with no secrets.
- `lib/sync/operation-id.ts` — client-generated `operation_id` primitive from ADR 0003, with unit tests.
- `lib/db/client.ts`, `drizzle.config.ts`, `lib/db/schema.ts` (empty placeholder) — Drizzle wired to a Postgres `DATABASE_URL`; no tables yet (Sprint 1 owns schema).
- Minimal, no-op-unless-configured observability wiring: `lib/observability/sentry.ts`, `lib/observability/posthog.ts`.
- CI: `.github/workflows/ci.yml` runs lint, typecheck, unit tests, Playwright E2E and production build on push/PR.
- ADRs: `0001` (self-hosted Coolify/Supabase hosting), `0002` (PowerSync, self-hosted edition), `0003` (operation_id/device_id contract), `0004` (currency snapshot model), `0005` (GoTrue + Africa's Talking custom SMS hook design).
- `docs/discovery.md` — drafted as unvalidated hypotheses, explicitly labeled as such.
- `project_description.md`, `docs/architecture.md`, `sprints.md` updated to remove Vercel/managed-Supabase references per ADR 0001.
- **Coolify staging deployed** (owner approved 2026-08-26): see "Coolify staging evidence" below.

## Coolify staging evidence (docs/runbooks/coolify-deployment.md exit items 1–2)

Server: `31.220.84.245` (Contabo, per `../../coolify-infra/README.md`). Project `stockflow-zw` (`k11lleqtpa6vnlvpe8ojzapz`), environment `production` (`ho2wewj5lcw6aaodhu0kgge6`) — this is currently the project's only/staging environment; not yet split into separate staging/production environments (reasonable to defer until there's a second environment's worth of real traffic).

**Next.js app** — `stockflow-zw-web`, uuid `xad1g9f4595ll32r0xwcyr0o`:
- `https://xad1g9f4595ll32r0xwcyr0o.31.220.84.245.sslip.io` — HTTP 200, PWA manifest and sync-status indicator confirmed live.
- Health check: `GET /api/health` → `{"status":"ok"}`, `200`, no secrets in response. Configured as the Coolify health-check path.
- Deployed via `/applications/public` (repo is public — confirmed via `gh repo view chihwayi/StokiPay --json isPrivate` → `false`), `build_pack: nixpacks`, `install_command: npm ci --include=dev` (works around the NODE_ENV/devDependencies gotcha), auto-deploy on push to `main` enabled.
- HTTPS forced via sslip.io + Let's Encrypt (Traefik).

**Self-hosted Supabase stack** — service `stockflow-zw-supabase`, uuid `o11niv82f82abmmfm95kvy76`, deployed via Coolify's built-in one-click `supabase` service template (not a hand-rolled compose) so every component gets a Coolify-managed high-entropy secret automatically:
- Public: `supabase-kong` only, at `https://supabasekong-o11niv82f82abmmfm95kvy76.31.220.84.245.sslip.io`. Verified: `GET /rest/v1/` with the service's anon key → `200`; `GET /auth/v1/health` → `200`.
- Private (no public FQDN, confirmed via API): `supabase-db`, `supabase-auth`, `supabase-rest`, `supabase-storage`, `supabase-meta`, `realtime-dev`, `supabase-studio`, `supabase-supavisor`, `supabase-edge-functions`, `supabase-analytics`, `supabase-vector`, `supabase-minio`, `imgproxy`.
- Postgres confirmed not publicly reachable: `supabase-db` API field `is_public: false`, and `nc -zv 31.220.84.245 5432` times out from outside the server.
- All 14 containers healthy after initial boot (`docker compose ps -a` on the host). One real deployment bug found and fixed in the process — recorded as gotcha #8 in `../../coolify-infra/README.md`: Coolify's `supabase` service template doesn't set a Traefik `loadbalancer.server.port` label on the multi-port `supabase-kong` container, which causes every HTTPS request to hang after a successful TLS handshake (fixed by editing the generated `docker-compose.yml` on the server directly and recreating the container — see the linked gotcha for the exact fix).
- Internal Postgres connection for other services in this project: host `supabase-db`, port `5432`, db `postgres`; password is a Coolify-managed secret (`POSTGRES_PASSWORD` in the service's env vars) — not recorded here per `CLAUDE.md`'s "never add secrets" rule.
- `ENABLE_PHONE_SIGNUP=true` and `ENABLE_PHONE_AUTOCONFIRM=true` are the template's defaults. **The autoconfirm setting is a placeholder and must be set to `false` in Sprint 1** once the Africa's Talking SMS hook (ADR 0005) is wired — right now a phone signup would be confirmed without ever sending or checking an OTP. Not fixed in Sprint 0 because nothing calls Auth yet and Sprint 1 owns the Auth implementation.

## Acceptance evidence

| Criterion | Evidence location / command | Result |
|---|---|---|
| `docs/discovery.md` identifies launch users, pains, pricing hypotheses, risks | `docs/discovery.md` | Hypotheses only — real interviews not conducted. See Blockers. |
| `docs/adr/` contains sync, idempotency and currency decisions | `docs/adr/0002`–`0005` | Done |
| A fresh clone can run locally using README instructions and `.env.example` | `README.md`; `npm install && npm run dev` verified | Done, with caveat: `.env.example` not updated (sandbox blocks `.env*` file access for this assistant). See Blockers. |
| CI runs lint, typecheck, unit test, E2E smoke test and production build | `.github/workflows/ci.yml`; run locally this session, see Verification run | Done locally; not yet observed running on GitHub Actions itself (pushed but not confirmed green in the Actions tab) |
| Staging shows the installable PWA shell and sync status | See "Coolify staging evidence" above | **Done** |

## Verification run

```text
Command: npm run lint       → pass, 0 errors/warnings
Command: npm run typecheck  → pass
Command: npm run test       → pass, 1 file / 3 tests (tests/unit/operation-id.test.ts)
Command: npm run test:e2e   → pass, 2 tests (tests/e2e/pwa-shell.spec.ts), Chromium
Command: npm run build      → pass, static build of /, /_not-found, /api/health, /manifest.webmanifest
Date: 2026-08-26
```

`next build`/`next dev` are pinned to `--webpack` because `@serwist/next` doesn't yet support Next 16's default Turbopack builder (serwist/serwist#54). `npm audit`: one remaining moderate advisory in `drizzle-kit`'s transitive `esbuild` (dev-only, fixing it means downgrading `drizzle-kit` to an older breaking version — left as-is and flagged). The higher-severity `drizzle-orm` SQL-identifier-escaping advisory is fixed (`drizzle-orm@^0.45.2`).

## Changed surfaces

- Migrations: none (no schema tables yet).
- Environment variables needed (not yet in `.env.example` — see Blockers): `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`.
- Routes/components: `app/layout.tsx`, `app/page.tsx`, `app/manifest.ts`, `app/sw.ts`, `app/api/health/route.ts`, `components/ui/status-badge.tsx`, `components/features/sync/sync-status-indicator.tsx`, `components/features/observability/observability-init.tsx`.
- Services/integrations: `lib/db/client.ts`, `lib/sync/operation-id.ts`, `lib/observability/sentry.ts`, `lib/observability/posthog.ts`.
- Infrastructure: Coolify project `stockflow-zw`; application `stockflow-zw-web`; service `stockflow-zw-supabase` (self-hosted Supabase stack). See `../../coolify-infra/README.md` for full resource inventory and gotcha #8.

## Decisions and limitations

- ADRs created/updated: 0001–0005 (see Scope delivered).
- Known limitations:
  - Sync-status component reflects `navigator.onLine` only, not real PowerSync state (lands Sprint 2, per ADR 0002 — PowerSync deployment itself is intentionally out of Sprint 0's scope, it is not in the runbook's Sprint 0 exit-evidence list).
  - No database schema exists yet.
  - Observability wiring is minimal (no-op without real DSN/keys), untested against a real Sentry/PostHog project.
  - `ENABLE_PHONE_AUTOCONFIRM=true` on the deployed Supabase Auth service is insecure-by-default and must be flipped in Sprint 1 (see Coolify staging evidence above).
  - The project/environment split is currently a single `production`-named Coolify environment rather than distinct staging/production environments — acceptable for now (no real tenant data exists), revisit before Sprint 10 launch prep.
- Blockers requiring a human/provider decision:
  1. **Real discovery interviews** (10–15 target users) have not been conducted; `docs/discovery.md` is hypotheses only.
  2. **`.env.example` could not be updated by this assistant** — the sandbox denies Read/Edit/Bash access to `.env*` files. The owner needs to add the variable names listed above (safe names/descriptions only, no real values, per `CLAUDE.md`).
  3. **Backup/restore evidence** (`docs/runbooks/coolify-deployment.md` exit item 4) is not done. The runbook requires encrypted backups copied *off* the Coolify host — this assistant has no external S3/second-server destination to send them to. Needs the owner to provide (or approve provisioning) an off-host backup destination (e.g. Backblaze B2, AWS S3, or a second server) before this can be completed and a restore drill run.
  4. **Africa's Talking sandbox credentials** are not yet available to actually test the OTP hook designed in ADR 0005 — that implementation is Sprint 1 scope regardless, but the sandbox transcript required by the runbook can't exist until Sprint 1 has real (sandbox) credentials.

## Next assistant

- Next permitted sprint: Sprint 0 is not yet exit-gated — the technical/infra work is done and verified, but do not start Sprint 1 until the owner resolves: (a) the discovery-interview gap, (b) `.env.example` (needs a session/owner with file access, or the owner adds it directly), (c) an off-host backup destination and restore-test date.
- First files to read: this file, `docs/discovery.md`, `docs/adr/0001`–`0005`, `docs/architecture.md`, `docs/runbooks/coolify-deployment.md`, `../../coolify-infra/README.md`.
- Do not do yet: any product/stock/POS schema, payment integration, or WhatsApp/AI work (per `CLAUDE.md`'s "First task" instruction); do not flip `ENABLE_PHONE_AUTOCONFIRM` or implement the Africa's Talking hook outside Sprint 1; do not mark Sprint 0's checkboxes in `sprints.md` complete until the three blockers above are resolved.
