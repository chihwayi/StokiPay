-- Defensive re-apply. Migration 0002 defines stockflow_auth_uid()
-- correctly (confirmed: CI's RLS integration tests pass against a fresh
-- Postgres running the full migration set from scratch), but the live
-- staging database ended up without it after a session of repeated
-- manual migration application over a flaky SSH tunnel (see
-- docs/handoffs/sprint-1.md) — this surfaced as "function
-- stockflow_auth_uid() does not exist" from the onboarding RPC. This
-- migration is redundant on a correctly-migrated database and exists
-- only so a fresh `npm run db:apply-migrations` run can't silently
-- reproduce the same gap.
create or replace function public.stockflow_auth_uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;
