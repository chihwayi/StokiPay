# ADR 0002 — PowerSync as the single local-first sync engine

## Status

`accepted`

## Context

`project_description.md` (§5.2–5.3) and `docs/architecture.md` require a true offline-first client: every stock/POS write must go to local storage first, then sync in the background, with no duplicate business events on retry. Hand-rolling this (custom outbox + conflict resolution) is high-risk and is explicitly called out in `project_description.md` as "the single biggest technical moat" if done well, and the biggest failure mode if done badly.

The self-hosted data platform is now a Postgres instance running as part of the self-hosted Supabase stack on Coolify (ADR 0001). Any sync engine choice must work against a self-hosted Postgres with logical replication, not assume Supabase Cloud specifically.

## Options considered

1. **Hand-rolled outbox/queue** (IndexedDB queue + custom replay/conflict logic). Full control, but reinvents a hard, correctness-critical problem (exactly-once replay, conflict resolution, partial-sync recovery) that this team has no prior track record building. Directly contradicts the mission statement's priority on reliability over feature speed.
2. **PowerSync** (Postgres-backed sync engine, purpose-built for local-first apps with SQLite/IndexedDB on the client and Postgres logical replication on the server). Has a **self-hosted (open) edition** that runs as its own service against any Postgres — including a self-hosted one — so it is compatible with ADR 0001's self-hosted Coolify data platform, not tied to Supabase Cloud.
3. **A generic CRDT sync library** (e.g. Yjs/Automerge-based). Better suited to collaborative document editing than to accounting-grade append-only ledgers with idempotency-key replay semantics; would require building the ledger/idempotency contract on top from scratch anyway.

## Decision

PowerSync remains the single selected local-first sync engine, now running as a **self-hosted PowerSync service** (Docker) deployed as another Coolify resource, connected to the self-hosted Postgres from ADR 0001 via logical replication. No second sync engine or custom parallel outbox is permitted without a superseding ADR (per `sprints.md`'s locked delivery decisions).

Client side: PowerSync's SQLite-backed local database in the browser (via its web SDK / IndexedDB-backed storage), with `lib/sync/` owning the PowerSync schema, local write adapters, `device_id`/`operation_id` generation, and conflict-review logic, per `docs/architecture.md`'s folder contract.

## Consequences

- **Positive:** One proven sync contract instead of a bespoke one; self-hosted edition keeps this fully on the owner's Coolify infrastructure per ADR 0001; PowerSync's sync rules give an explicit, reviewable mapping from Postgres tables to client-visible data (useful for tenant scoping).
- **Costs/risks:** Adds an operational service (PowerSync) to keep patched and monitored on Coolify, in addition to Postgres/GoTrue/Storage/Realtime. The self-hosted (open) edition has a smaller community/support surface than the managed cloud offering — verify version compatibility with the self-hosted Supabase Postgres version before each upgrade.
- **Migration or verification needed:** Sprint 0 adds only the PWA shell and a visible sync-state UI component (online/offline/syncing indicator) — not the full PowerSync wiring. Actual PowerSync schema, local write adapters and the `operation_id`/`device_id` contract are implemented starting Sprint 2 (first stock write) per `sprints.md`, and every core stock/POS write must use this path from its first implementation, never a later retrofit (cross-sprint invariant #5).
