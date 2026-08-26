-- Sprint 1 RLS policies. Hand-written (not drizzle-kit generated) because
-- these reference auth.uid() and helper functions Drizzle's schema API
-- doesn't express. See docs/runbooks/coolify-deployment.md's "Database and
-- RLS boundary" section and CLAUDE.md rule 1.
--
-- staff_users.id == auth.users.id (one GoTrue user == one staff_user row,
-- scoped to exactly one tenant). SECURITY DEFINER helper functions let
-- policies on other tables look up the caller's tenant/role without
-- recursing back through staff_users' own RLS.

create or replace function public.stockflow_auth_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select tenant_id from staff_users where id = auth.uid()
$$;

create or replace function public.stockflow_auth_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role::text from staff_users where id = auth.uid()
$$;

alter table tenants enable row level security;
alter table tenants force row level security;
alter table branches enable row level security;
alter table branches force row level security;
alter table staff_users enable row level security;
alter table staff_users force row level security;
alter table devices enable row level security;
alter table devices force row level security;
alter table audit_log enable row level security;
alter table audit_log force row level security;

grant select, insert, update, delete on tenants to authenticated;
grant select, insert, update, delete on branches to authenticated;
grant select, insert, update, delete on staff_users to authenticated;
grant select, insert, update, delete on devices to authenticated;
grant select, insert, update, delete on audit_log to authenticated;

-- tenants: readable by your own tenant only. No client-side insert/update/
-- delete policy — tenant creation is a privileged, service-role,
-- transaction-scoped onboarding operation (see ADR 0006), not a direct
-- authenticated-client write.
create policy tenants_select_own on tenants
  for select
  using (id = stockflow_auth_tenant_id());

-- branches: any staff member of the tenant can see branches; only
-- owner/manager can create or edit them (Sprint 1 acceptance criterion:
-- "a cashier cannot manage ... branches").
create policy branches_select_own_tenant on branches
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy branches_insert_owner_manager on branches
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
  );

create policy branches_update_owner_manager on branches
  for update
  using (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
  )
  with check (tenant_id = stockflow_auth_tenant_id());

-- staff_users: any staff member of the tenant can see their coworkers.
-- No client-side insert policy — the first owner row and all later staff
-- invites are privileged, service-role, audited operations (ADR 0006).
-- Only owner/manager can update (role changes, deactivation) — Sprint 1
-- acceptance criterion: "a cashier cannot manage staff".
create policy staff_users_select_own_tenant on staff_users
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy staff_users_update_owner_manager on staff_users
  for update
  using (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
  )
  with check (tenant_id = stockflow_auth_tenant_id());

-- devices: any staff member can see their tenant's devices and register/
-- update only their own device (device_id/staff binding used by the
-- offline sync contract, ADR 0003).
create policy devices_select_own_tenant on devices
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy devices_insert_own on devices
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and staff_user_id = auth.uid()
  );

create policy devices_update_own on devices
  for update
  using (
    tenant_id = stockflow_auth_tenant_id()
    and staff_user_id = auth.uid()
  )
  with check (tenant_id = stockflow_auth_tenant_id());

-- audit_log: append-only (CLAUDE.md rule 2) — no update or delete policy
-- is ever granted. Select restricted to owner/manager (accountability
-- visibility, not general staff visibility). Insert allowed for any staff
-- member logging their own action.
create policy audit_log_select_owner_manager on audit_log
  for select
  using (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
  );

create policy audit_log_insert_own_tenant on audit_log
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and actor_staff_user_id = auth.uid()
  );
