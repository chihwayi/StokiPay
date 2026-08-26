-- ADR 0006's privileged onboarding path, implemented as a SECURITY
-- DEFINER RPC rather than a service-role server route: the caller's
-- identity comes from their own JWT (via stockflow_auth_uid(), the same
-- GUC PostgREST always sets), never a client-supplied parameter, so it's
-- safe to expose to the plain `authenticated` role through PostgREST's
-- RPC endpoint. Runs as the function owner (postgres, BYPASSRLS), which
-- is what lets it create the very first staff_users row for a brand-new
-- user who doesn't have one yet — the RLS chicken-and-egg problem ADR
-- 0006 describes — while still being fully transaction-scoped and
-- audit-logged.

create or replace function public.stockflow_onboard_tenant(
  p_tenant_name text,
  p_vertical text,
  p_owner_phone text
)
returns table(tenant_id uuid, branch_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := stockflow_auth_uid();
  v_tenant_id uuid;
  v_branch_id uuid;
begin
  if v_owner_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if exists (select 1 from staff_users where id = v_owner_id) then
    raise exception 'this account is already onboarded to a tenant' using errcode = '23505';
  end if;

  insert into tenants (name, vertical) values (p_tenant_name, p_vertical)
    returning id into v_tenant_id;

  insert into branches (tenant_id, name, is_primary) values (v_tenant_id, 'Main Branch', true)
    returning id into v_branch_id;

  insert into staff_users (id, tenant_id, branch_id, phone, role)
    values (v_owner_id, v_tenant_id, v_branch_id, p_owner_phone, 'owner');

  insert into audit_log (tenant_id, actor_staff_user_id, action, entity_type, entity_id)
    values (v_tenant_id, v_owner_id, 'tenant.onboarded', 'tenant', v_tenant_id);

  return query select v_tenant_id, v_branch_id;
end;
$$;

grant execute on function public.stockflow_onboard_tenant(text, text, text) to authenticated;
