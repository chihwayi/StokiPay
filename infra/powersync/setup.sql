-- Postgres-side setup for the self-hosted PowerSync service (ADR 0002).
-- Run once against the target Postgres (idempotent). Not a Drizzle
-- migration: this provisions PowerSync's own replication/storage
-- plumbing, not application (tenant) schema.
--
-- Requires wal_level=logical (Supabase ships this by default for Realtime).

-- Replication role: reads committed changes via a logical replication
-- slot. BYPASSRLS is required — PowerSync replicates raw table changes
-- outside any application session/JWT context, so it cannot satisfy our
-- tenant-scoped RLS policies (rule 1) and must read unfiltered; tenant
-- scoping for what a *client* receives is enforced separately by
-- sync_rules.yaml, not by RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
    CREATE ROLE powersync_role WITH REPLICATION LOGIN PASSWORD 'REPLACE_ME';
  END IF;
END $$;
ALTER ROLE powersync_role BYPASSRLS;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;

CREATE PUBLICATION powersync FOR TABLE
  tenants, branches, staff_users, devices,
  products, stock_movements, stock_counts, stock_count_lines;

-- Storage role: PowerSync's own bucket/checkpoint/lock bookkeeping.
-- Not REPLICATION-capable (deliberately separate connection/role from
-- the replication role above — see docs/handoffs/sprint-2.md for why
-- this was tested and ruled out as the crash cause).
--
-- IMPORTANT: the schema name is hardcoded to `powersync` inside
-- PowerSync itself (STORAGE_SCHEMA_NAME in
-- modules/module-postgres-storage/dist/utils/db.js as of v1.25.0) — it
-- is not configurable via config.yaml. Using any other schema name here
-- (e.g. `powersync_storage`) will crash-loop with a generic "postgres
-- query failed" on startup, because CREATE SCHEMA IF NOT EXISTS on an
-- unexpected/missing `powersync` schema fails for a role with no
-- database-level CREATE privilege — surfaced by Postgres as "permission
-- denied for database postgres", not a schema-specific error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_storage_role') THEN
    CREATE ROLE powersync_storage_role WITH LOGIN PASSWORD 'REPLACE_ME';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS powersync;
GRANT ALL ON SCHEMA powersync TO powersync_storage_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA powersync GRANT ALL ON TABLES TO powersync_storage_role;
