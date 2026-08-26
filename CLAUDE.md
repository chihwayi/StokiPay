# StockFlow ZW — Operating Instructions for Claude

## Mission

Build StockFlow ZW only according to `project_description.md` and `sprints.md`. This is a Zimbabwean, offline-first SME POS and stock-management PWA. Reliability, tenant isolation and accounting truth are more important than feature speed.

## Mandatory reading order

Before any change, read:

1. `project_description.md`
2. `sprints.md`
3. `docs/architecture.md`
4. `docs/runbooks/coolify-deployment.md`
5. the latest file in `docs/handoffs/`
6. the active sprint's ADRs in `docs/adr/`

If a required document does not exist, create it only if the active sprint asks for it. Do not infer a later feature or create speculative integrations.

## Working contract

- Work on one sprint only. State the sprint number and acceptance criteria you are addressing before editing.
- Do not begin a sprint until the preceding sprint's handoff note records a passing exit gate.
- Before adding a dependency, explain which accepted task requires it. Prefer the locked stack in `docs/architecture.md`.
- Do not change a locked decision without an ADR in `docs/adr/` explaining options, impact, and the explicit owner decision needed.
- No destructive database changes. Use forward-only Drizzle migrations.
- Never add secrets to the repository. Update `.env.example` with variable names and safe descriptions only.
- Do not claim a provider integration, fiscal compliance, performance target, or security result without recorded evidence.

## Non-negotiable implementation rules

1. Every tenant-owned table has `tenant_id`, RLS policies, tenant-scoped queries and an automated cross-tenant denial test.
2. Sales, payments, stock movements, cash-up and refunds are append-only accounting events. Completed records are reversed by linked records, never edited/deleted.
3. Every stock or money write is atomic and idempotent. Capture `operation_id` and `device_id`; a retry must not duplicate a business event.
4. Core stock/POS writes go through the local-first PowerSync path from their first implementation.
5. Store original currency, amount, exchange-rate snapshot, source/approval and reporting value on every monetary transaction. Supported active currencies are ZiG, USD and ZAR; legacy ZWL is historical only.
6. AI can only use tenant-scoped, read-only tools and must not block a manual workflow.
7. Verify provider webhooks, make them idempotent, and implement a reconciliation fallback.

## Required completion evidence

For every sprint, create `docs/handoffs/sprint-<n>.md` using `docs/templates/sprint-handoff.md`. Run and record the repository equivalents of lint, typecheck, unit tests, E2E tests and production build. Check off acceptance criteria in `sprints.md` only after the evidence exists.

## First task

Start with Sprint 0 only. Do not create products, POS screens, Supabase schema, or payment integrations until its discovery, ADR and verification gates are complete.

For infrastructure work, follow `docs/runbooks/coolify-deployment.md` exactly. Do not provision paid-server resources or expose services without the owner's explicit approval.
