# Sprint 2 Handoff — Product, Stock & Inventory Controls

## Status

`in progress` — schema, RLS, reconciliation, blind-count and rate-role logic are built, tested (34 integration tests, CI green) and verified end-to-end on live staging via the real Kong/PostgREST endpoint. UI for products, stock receipts/adjustments and blind counts is live. **Offline queueing via PowerSync is blocked and deferred** (see below) — every write in this sprint currently goes straight to the server, not through a local-first queue.

## Scope delivered

- `products`, `stock_movements` (append-only, `UNIQUE(tenant_id, operation_id)` idempotency per ADR 0003), `exchange_rates` (ADR 0004), `stock_counts`/`stock_count_lines`, and a `stock_levels` view (`security_invoker`, derived from movements only — never an independently-writable total).
- RLS: any tenant staff can log a receipt/adjustment for themselves on their own registered device; only owner/manager can create/edit products or approve exchange rates (the "rate role"); reason required for adjustments via CHECK constraint.
- `stockflow_submit_stock_count`/`stockflow_approve_stock_count` (SECURITY DEFINER) implement genuinely blind counts — the counter can never see or set `expected_quantity` (RLS-enforced, not just a UI convention), and a variance only becomes a stock movement after owner/manager approval.
- UI: `/products`, `/products/new`, inline receive/adjust forms, `/counts` → `/counts/new` → `/counts/[id]` (blind entry → submit → owner/manager review → approve).
- 34 integration tests (`tests/integration/{rls,stock}.test.ts`) covering reconciliation, idempotent replay, reason-required adjustments, device/actor spoofing denial, rate-role denial, and the full blind-count flow.
- Verified live end-to-end via the real Kong/PostgREST endpoint (not just direct Postgres): onboarded a tenant, created a product, registered a device, received stock, confirmed `stock_levels` reconciled — then cleaned up.

## PowerSync — attempted, blocked, deferred

Per ADR 0002, Sprint 2 is where PowerSync's real client wiring was supposed to land. Progress:

1. **Postgres side (done, verified):** `wal_level=logical` already set (Supabase ships this for Realtime). Created a least-privilege `powersync_role` (REPLICATION + LOGIN, `SELECT` on `public`, full rights on a dedicated `powersync_storage` schema for its own bucket/lock state) and a `CREATE PUBLICATION powersync FOR TABLE tenants, branches, staff_users, devices, products, stock_movements, stock_counts, stock_count_lines`.
2. **Service deployment (done, config confirmed correct):** `infra/Dockerfile.powersync` + `infra/powersync/{config.yaml,sync_rules.yaml}` — config schema and the `client_auth.supabase`/`supabase_jwt_secret` shortcut were confirmed correct by reading the actual config-parsing code inside the `journeyapps/powersync-service` image (no official docs site was reachable this session). Deployed as Coolify application `stockflow-zw-powersync` (uuid `idbsgh31p9tdpa2pkx3c434n`), manually joined to the Supabase service's Docker network (same pattern as gotcha #7/#9 — Coolify applications don't share networks with services by default).
3. **Blocked:** the container crash-loops on startup with `Fatal startup error - exiting with code 150. postgres query failed`, thrown from `PostgresLockManager.init()`'s `CREATE TABLE IF NOT EXISTS locks (...)` — the very first query PowerSync runs against its storage connection. Ruled out so far:
   - Not a network/DNS issue: a debug `postgres:15-alpine` container on the same Docker network, using the *exact* connection string PowerSync has (confirmed via `docker exec ... env`), connects and runs `SELECT 1` fine.
   - Not a permissions issue: the same debug container successfully ran `CREATE TABLE powersync_storage.test_lock(...); DROP TABLE ...;` as `powersync_role` over that exact connection string.
   - Not (apparently) a config-loading issue: `PS_LOG_LEVEL=debug` shows the config loads, modules register, and the failure happens specifically inside the first real query — but the logged error is a generic wrapped message with no underlying Postgres error code/detail surfaced, even at debug level.
   - Tested and **disproven**: hypothesized the storage connection was inheriting replication-protocol semantics from sharing `powersync_role`/URI with the replication connection (a replication-protocol connection only accepts `START_REPLICATION`/`IDENTIFY_SYSTEM`-style commands, not arbitrary DDL, which would explain "works via plain psql, fails via PowerSync's pooled connection"). Created a fully separate `powersync_storage_role` (no `REPLICATION` attribute, distinct login, same schema grants) and pointed `PS_STORAGE_URI` at it exclusively — identical crash, identical error. Rules this out.
   - Not yet tested: whether the unified runner mode itself is the issue (splitting into separate `api`/`sync` runner processes via `-r api` / `-r sync` instead of `-r unified`), or whether `journeyapps/powersync-service:latest` has a version-specific bug (no version pin was used — worth trying an explicit older tag).
4. **Stopped, not deleted:** the crash-looping container is stopped (not left crash-looping and burning restarts on the server) but the Coolify application resource, migrations, publication and role are left in place for whoever picks this up next.

This was cut off deliberately rather than continued indefinitely — it was heading toward the same open-ended, low-yield binary-archaeology pattern the Sprint 1 GoTrue Send-SMS-Hook investigation fell into, and the owner's instruction there ("no need to fix sms otp yet... we go next") is the precedent for how this project wants that kind of blocker handled: document precisely, don't block other work, revisit when there's a stronger signal (e.g. actual PowerSync support/docs access, or a maintainer response).

## Next assistant

- To resume PowerSync: try a **separate, non-replication storage role** first (highest-probability fix per the hypothesis above); if that doesn't resolve it, this likely needs PowerSync's actual documentation/Discord/support (not accessible this session) rather than more binary reverse-engineering.
- Everything else in this file's "Scope delivered" section is real, tested, and live — safe to build Sprint 3 (POS) on top of it. Sales writes will have the same "online-only for now" characteristic as this sprint's stock writes until PowerSync is unblocked.
- First files to read: this file, `docs/adr/0002-powersync-local-first-sync.md`, `infra/powersync/config.yaml`, `infra/Dockerfile.powersync`.
