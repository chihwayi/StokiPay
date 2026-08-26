-- Fixes a real CI failure: the bare `supabase/postgres` image (no GoTrue
-- service actually running, used by CI's ephemeral Postgres container)
-- does not resolve auth.uid() the same way the fully-deployed self-hosted
-- Supabase stack does (GoTrue's own startup is what finishes wiring
-- auth.uid() in some image/version combinations). Rather than depend on
-- that implementation detail, define our own JWT-claims reader against
-- the same `request.jwt.claims` GUC PostgREST actually sets on every
-- request — this is the real, stable integration point, and works
-- identically on staging and on a bare Postgres instance in CI.

create or replace function public.stockflow_auth_uid()
returns uuid
language sql
stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;

create or replace function public.stockflow_auth_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from staff_users where id = stockflow_auth_uid()
$$;

create or replace function public.stockflow_auth_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role::text from staff_users where id = stockflow_auth_uid()
$$;

drop policy devices_insert_own on devices;
create policy devices_insert_own on devices
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and staff_user_id = stockflow_auth_uid()
  );

drop policy devices_update_own on devices;
create policy devices_update_own on devices
  for update
  using (
    tenant_id = stockflow_auth_tenant_id()
    and staff_user_id = stockflow_auth_uid()
  )
  with check (tenant_id = stockflow_auth_tenant_id());

drop policy audit_log_insert_own_tenant on audit_log;
create policy audit_log_insert_own_tenant on audit_log
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and actor_staff_user_id = stockflow_auth_uid()
  );
