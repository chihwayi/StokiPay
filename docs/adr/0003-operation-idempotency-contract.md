# ADR 0003 — Event/idempotency format for offline-safe writes

## Status

`accepted`

## Context

Cross-sprint invariant #2 (`sprints.md`) and `CLAUDE.md` rule 3 require: every stock or money write is atomic and idempotent; it captures `operation_id` and `device_id`; a retry (offline replay, sync reconnect, double-tap on a flaky connection) must never duplicate a business event. This must be decided before Sprint 2 (first stock write) and Sprint 3 (first sale write) so the schema is right from their first implementation.

## Options considered

1. **Server-generated IDs, dedupe by request hash.** Fails offline: the client cannot get a server-generated ID before it has connectivity, and hashing mutable request bodies is fragile against legitimate near-duplicate operations (e.g. two separate sales of the same single item, same price, same second).
2. **Client-generated UUID `operation_id` per business action, unique constraint at the database boundary, `device_id` recorded alongside every write.** Standard local-first pattern; the client can generate the ID offline, the ID travels with the queued PowerSync operation, and the server enforces uniqueness so replay is a no-op, not a duplicate.

## Decision

Every stock movement, sale, payment, cash-up event and return is a row with:

- `id` — UUID, the durable business-record primary key (per `docs/architecture.md`'s "UUIDs for durable business IDs" convention).
- `operation_id` — UUID v4, generated client-side at the moment the user commits the action (not at sync time). Carries a `UNIQUE` constraint (scoped per `tenant_id`) at the database layer, enforced independently of application logic.
- `device_id` — the registered device identifier (Sprint 1 `devices` table), recorded on every write so an operation's origin is always traceable for conflict review and audit.
- `created_by` (staff user) and `created_at` (client-observed timestamp, distinct from the server-assigned commit timestamp) for audit trail purposes.

Replay behavior: if a write with an already-seen `operation_id` for that tenant reaches the server (PowerSync re-uploads after a dropped ack, a user retries a failed submit, etc.), the server treats it as a successful no-op and returns the existing record rather than erroring or inserting a duplicate — this is enforced by the unique constraint plus an `ON CONFLICT (tenant_id, operation_id) DO NOTHING`-style upsert in the write path, never by client-side "don't double click" UI logic alone.

This `operation_id`/`device_id` pair is the same contract used across sales, stock movements, cash-up and refunds — one format, not a per-domain variant — so `lib/domain/` and `lib/sync/` share a single idempotency helper.

## Consequences

- **Positive:** Correctness holds even with zero connectivity at the moment of action; the same contract works identically online and offline, so there is no special-cased "online path" that skips idempotency.
- **Costs/risks:** Every tenant-owned append-only table needs the `operation_id` unique constraint and a replay test from its first migration — retrofitting this later would be a breaking migration on live data, which is why it is locked now, before Sprint 2.
- **Migration or verification needed:** Sprint 2 and Sprint 3 acceptance evidence explicitly require a replay test ("replaying the same operation ID creates one sale only" / stock reconciliation test) — this ADR is the contract those tests must verify against.
