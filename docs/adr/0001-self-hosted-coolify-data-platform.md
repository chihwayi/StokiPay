# ADR 0001 — Self-hosted Coolify hosting and data platform (replacing Vercel + managed Supabase)

## Status

`accepted`

## Context

`project_description.md` and `docs/architecture.md` originally locked "Vercel (frontend/API) + Supabase (managed DB/Auth/Storage/Realtime)" as the hosting and data platform, on the basis of minimal DevOps overhead and a generous free tier.

The owner has since moved to running their own paid infrastructure — a Coolify instance on a dedicated Contabo server (`31.220.84.245`, 12GB RAM) — and already deploys other production projects there (ilizwi, zimhealth-cpd, folium, vaultstream). The owner's explicit instruction (2026-08-26) is: "I am moving, I need everything on Coolify," with the additional requirement to use "whatever best security db we can use on own server."

This repo's non-negotiable rules (`CLAUDE.md` #1) require every tenant-owned table to have Postgres RLS policies and a cross-tenant denial test — RLS-enforced multi-tenancy is not optional and cannot be redesigned casually this late. Any replacement platform must preserve: Postgres with RLS, phone/OTP auth, object storage for receipts/ledger photos, and a realtime channel for multi-till live updates, since these are referenced throughout `sprints.md`.

## Options considered

1. **Keep managed Supabase, move only the Next.js app to Coolify.** Lowest migration risk, but does not satisfy "I need everything on Coolify" and keeps a recurring managed-cloud cost the owner is trying to avoid.
2. **Self-host the open-source Supabase stack (Postgres + GoTrue Auth + PostgREST + Realtime + Storage + Kong) as Docker services on Coolify.** Preserves the exact security model already designed around (native Postgres RLS, phone/OTP via GoTrue's SMS provider integration, S3-compatible Storage, logical-replication-based Realtime), so no redesign of the tenancy/auth/RLS approach is needed — only the operator changes from Supabase Inc. to the owner's own server. This is the same pattern already proven on this server for `vaultstream` (Postgres + backend + frontend + storage as separate Coolify resources, see `../../coolify-infra` / reference memory).
3. **Plain self-hosted Postgres + a hand-rolled auth/session/OTP/storage layer.** Maximum control, but re-implements security-sensitive code (session handling, OTP delivery/rate-limiting, password/token storage) that GoTrue already solves and has been audited in the wild. Higher risk of introducing an auth vulnerability, directly against the mission statement's priority on reliability over feature speed.

## Decision

Adopt **Option 2**, approved by the owner (chihwayii@outlook.com) on 2026-08-26: self-host the Supabase stack (Postgres 15+, GoTrue, PostgREST, Realtime, Storage, Kong) as Docker Compose services deployed via Coolify on the owner's Contabo server. This is deployed as its own Coolify project (mirroring the `vaultstream` pattern), separate from the Next.js application resource.

Concretely:

- **Database**: self-hosted Postgres (via the Supabase stack's Postgres image, which ships the same `pgsodium`/RLS/extension set as Supabase Cloud) on Coolify, with tenant isolation enforced by native Postgres RLS exactly as already designed. Automated encrypted backups (`pg_dump` + off-box copy) are required before any tenant data is real — tracked as a Sprint 0/10 task, not yet implemented.
- **Auth**: self-hosted GoTrue, configured for phone number + OTP as primary login, using **Africa's Talking** as the SMS provider (confirmed by owner 2026-08-26) — reuses the SMS vendor already locked in for SMS fallback per `docs/architecture.md`, avoiding a second SMS integration.
- **Storage**: self-hosted Supabase Storage (S3-compatible) for product photos and AI ledger-import images.
- **Realtime**: self-hosted Supabase Realtime for live multi-till/multi-device updates.
- **Frontend/API (Next.js)**: deployed as a separate Coolify application resource (Docker/nixpacks build pack), not Vercel.
- **PowerSync**: unaffected by this ADR — PowerSync's self-hosted (open) edition talks to any Postgres via logical replication, so it runs as another Coolify service pointed at the self-hosted Postgres instance above. No change to the Sprint 0 PowerSync ADR is implied.
- Reference operational details (API tokens, deploy gotchas, existing resources) live in `../../coolify-infra/README.md`, treated as the source of truth for how to operate this Coolify instance.

Encryption at rest and in transit: enable disk-level encryption on the Contabo volume (owner to confirm Contabo's encrypted-volume offering or apply LUKS at the OS level) and terminate all public traffic via Coolify/Traefik automatic HTTPS (Let's Encrypt), consistent with the sslip.io + HTTPS pattern already proven for `vaultstream`.

## Consequences

- **Positive:** No recurring Vercel/Supabase Cloud subscription cost; owner has full operational control on infrastructure they already pay for and know how to operate; the RLS-based tenancy model, phone/OTP auth flow and realtime requirements already designed in `project_description.md`/`sprints.md` remain valid as-is — this is a hosting-location change, not a data-model or auth-model change.
- **Costs/risks:** The owner is now responsible for Postgres backups, security patching, and uptime that Supabase Cloud previously handled — this must be built explicitly (backup/restore drill is already a Sprint 10 exit-gate item and now also matters much earlier). Self-hosted Supabase's Docker Compose stack needs to be kept up to date manually. No managed point-in-time-recovery unless configured by hand.
- **Migration or verification needed:** `project_description.md`, `docs/architecture.md` and `sprints.md` are updated in the same change as this ADR to remove references to Vercel and managed Supabase. Sprint 0 must add: a Coolify project for StockFlow ZW's Postgres/Auth/Storage/Realtime stack, a documented backup procedure, and CI/deploy wiring to Coolify's API (per the gotchas already recorded in `../../coolify-infra/README.md`) instead of a Vercel integration.
