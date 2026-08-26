# Architecture and Folder Contract

This document fixes the intended code boundaries. Empty folder README files are deliberate placeholders; implement them only in the sprint that owns them.

## Locked stack

| Concern | Decision |
|---|---|
| Application | Current supported Next.js App Router, React, TypeScript |
| UI | Tailwind CSS, shadcn/ui, Radix primitives |
| Database/auth/storage | Self-hosted Supabase stack (Postgres, GoTrue Auth, PostgREST, Storage, Realtime, RLS) on Coolify — see ADR 0001 |
| Migrations/query types | Drizzle ORM |
| Offline sync | PowerSync + IndexedDB; no alternative engine without ADR |
| PWA | Workbox/service worker integrated with the sync contract |
| Payments | Paynow first; provider adapters keep payment logic isolated |
| Messaging | WhatsApp Cloud API; Africa's Talking only for SMS fallback |
| AI | Anthropic API behind tenant-scoped, read-only server tools |
| Tests | Vitest, Playwright, Postgres/RLS integration tests against the self-hosted stack |
| Operations | GitHub Actions, Coolify (self-hosted on Contabo — see `../../coolify-infra`), Sentry, PostHog |

## Folder ownership

| Folder | Allowed responsibility | Must not contain |
|---|---|---|
| `app/` | Routes, layouts, page composition and route handlers | Direct database access from UI pages |
| `components/ui/` | Generic reusable UI primitives | Business rules or Supabase calls |
| `components/features/` | Feature UI grouped by domain (`pos`, `stock`, `reports`) | Cross-domain persistence logic |
| `lib/db/` | Drizzle schema, migrations, transaction repositories | Browser-only code or provider UI |
| `lib/auth/` | Session, authorization and tenant context | Business feature permissions hidden only in UI |
| `lib/sync/` | PowerSync schema, local write adapters, operation IDs, conflict handling | Financial calculations unrelated to synchronization |
| `lib/domain/` | Pure business rules: money, stock, ledgers, cash-up | HTTP, React or provider SDK calls |
| `lib/integrations/` | Isolated Paynow, WhatsApp, SMS, AI and FX adapters | Direct UI rendering or raw unscoped DB access |
| `lib/observability/` | Safe logging, metrics and error reporting | Secrets or full customer financial payloads |
| `tests/` | Unit, integration, RLS and E2E tests mirroring domains | Production-only helpers |
| `docs/` | Decisions, handoffs, runbooks, evidence and templates | Credentials or customer personal data |

## Dependency direction

`app/components → lib/domain + lib/auth + lib/sync → lib/db/integrations`

Server-side integration adapters may call repositories only through tenant-scoped service methods. Browser components must never receive a service-role key or bypass RLS.

## Required implementation conventions

- Use UUIDs for durable business IDs and `operation_id` for replay protection.
- Store money as integer minor units plus ISO-like currency code; document ZiG precision before first migration.
- Use database transactions for online authoritative commits and the PowerSync operation contract for offline commits.
- Write tests beside/alongside each domain module and add an E2E test for any cashier or owner workflow.
- Add an ADR before changing a cross-cutting boundary, sync model, currency model, tenancy model, or provider.
