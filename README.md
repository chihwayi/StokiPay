# StockFlow ZW

An offline-first, multi-tenant stock, sales and business-management PWA for Zimbabwean SMEs.

## Project status

Sprint 0 in progress: Next.js/TypeScript/Tailwind foundation, PWA shell, CI and initial ADRs are in place. No product/stock/POS features exist yet — see `sprints.md` for the delivery plan.

## Local development

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and provider keys
npm run dev                  # http://localhost:3000
```

Verification commands (same as CI, see `.github/workflows/ci.yml`):

```bash
npm run lint
npm run typecheck
npm run test        # Vitest unit tests
npm run test:e2e     # Playwright E2E (builds and serves the app first)
npm run build
```

The database is a self-hosted Postgres instance (part of a self-hosted
Supabase stack) running on our own Coolify server — see
`docs/adr/0001-self-hosted-coolify-data-platform.md` and
`../../coolify-infra/README.md` for how that server is operated. `DATABASE_URL`
in `.env.local` must point at that instance (or a local Postgres for
development) — no schema exists yet; it is added starting Sprint 1.

## Start here

1. Read `CLAUDE.md` if you are an AI coding assistant.
2. Read `project_description.md` for the product definition.
3. Read `sprints.md` for the modular delivery and verification contract.
4. Read `docs/architecture.md` before making technical decisions.
5. Read `docs/runbooks/coolify-deployment.md` before any deployment or database work.
6. Read the newest `docs/handoffs/` entry before continuing a sprint.

## Important boundaries

- Do not treat this as a generic POS: offline safety, multi-currency integrity and tenant isolation are core requirements.
- Do not create code outside the active sprint.
- Do not claim fiscal/ZIMRA compliance without independently verified requirements and integration evidence.

## Repository map

- `app/` — Next.js routes and composition.
- `components/` — UI primitives and feature UI.
- `lib/` — database, auth, sync, domain rules, provider adapters and observability.
- `tests/` — automated verification.
- `docs/` — architecture, ADRs, handoffs, templates and Claude prompts.
