-- Sprint 2 RLS, constraints, derived view and privileged functions.
-- See sprints.md's Sprint 2 acceptance criteria and CLAUDE.md rules 1-3.

alter table products enable row level security;
alter table products force row level security;
alter table stock_movements enable row level security;
alter table stock_movements force row level security;
alter table exchange_rates enable row level security;
alter table exchange_rates force row level security;
alter table stock_counts enable row level security;
alter table stock_counts force row level security;
alter table stock_count_lines enable row level security;
alter table stock_count_lines force row level security;

grant select, insert, update, delete on products to authenticated;
grant select, insert, update, delete on stock_movements to authenticated;
grant select, insert, update, delete on exchange_rates to authenticated;
grant select, insert, update, delete on stock_counts to authenticated;
grant select, insert, update, delete on stock_count_lines to authenticated;

-- Idempotency contract (ADR 0003): a retried operation_id is a no-op, not
-- a duplicate. Scoped per tenant, not globally, so two tenants can't
-- collide on a client-generated UUID (they can't anyway at UUIDv4
-- collision odds, but this keeps the constraint meaningful per-tenant).
alter table stock_movements add constraint stock_movements_tenant_operation_unique
  unique (tenant_id, operation_id);

-- Reason-coded adjustments (sprints.md Sprint 2 task) — a receipt needs
-- no reason, an adjustment or count-variance movement always does.
alter table stock_movements add constraint stock_movements_reason_required_for_adjustment
  check (movement_type = 'receipt' or (reason is not null and length(trim(reason)) > 0));

alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('receipt', 'adjustment', 'count_variance'));

alter table stock_counts add constraint stock_counts_status_check
  check (status in ('open', 'submitted', 'approved'));

-- Derived stock-on-hand — never an independently-writable total, always
-- the sum of movements (sprints.md's reconciliation acceptance
-- criterion). security_invoker means the view is subject to the
-- querying user's own RLS on stock_movements, not the view owner's.
create view stock_levels
  with (security_invoker = true) as
  select tenant_id, branch_id, product_id, sum(quantity_delta)::integer as quantity
  from stock_movements
  group by tenant_id, branch_id, product_id;

grant select on stock_levels to authenticated;

-- products: any tenant staff can see the catalogue; only owner/manager
-- can create or edit products or their prices ("rate role" — reusing the
-- existing owner/manager privilege tier rather than introducing a
-- separate permission dimension, consistent with the branches/staff
-- policies from Sprint 1).
create policy products_select_own_tenant on products
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy products_insert_owner_manager on products
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
  );

create policy products_update_owner_manager on products
  for update
  using (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
  )
  with check (tenant_id = stockflow_auth_tenant_id());

-- stock_movements: any tenant staff can log a receipt/adjustment for
-- themselves, on a device that's actually registered to them. Never
-- update/delete — append-only.
create policy stock_movements_select_own_tenant on stock_movements
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy stock_movements_insert_own_device on stock_movements
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and actor_staff_user_id = stockflow_auth_uid()
    and device_id in (select id from devices where staff_user_id = stockflow_auth_uid())
    and movement_type in ('receipt', 'adjustment')
  );

-- exchange_rates: any tenant staff can read; only owner/manager can add
-- a new approved rate ("a user without the rate role cannot alter a
-- rate" — sprints.md Sprint 2 acceptance criterion).
create policy exchange_rates_select_own_tenant on exchange_rates
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy exchange_rates_insert_owner_manager on exchange_rates
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and stockflow_auth_role() in ('owner', 'manager')
    and approved_by = stockflow_auth_uid()
  );

-- stock_counts / stock_count_lines: any staff can open a count and enter
-- their own counted quantities. expected_quantity can never be set by a
-- plain insert (only stockflow_submit_stock_count below sets it) — this
-- is the actual "blind" guarantee, not just a UI convention.
create policy stock_counts_select_own_tenant on stock_counts
  for select
  using (tenant_id = stockflow_auth_tenant_id());

create policy stock_counts_insert_own on stock_counts
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and created_by = stockflow_auth_uid()
  );

create policy stock_count_lines_select_own_tenant on stock_count_lines
  for select
  using (
    exists (
      select 1 from stock_counts
      where stock_counts.id = stock_count_lines.stock_count_id
        and stock_counts.tenant_id = stockflow_auth_tenant_id()
    )
  );

create policy stock_count_lines_insert_blind on stock_count_lines
  for insert
  with check (
    expected_quantity is null
    and exists (
      select 1 from stock_counts
      where stock_counts.id = stock_count_lines.stock_count_id
        and stock_counts.tenant_id = stockflow_auth_tenant_id()
        and stock_counts.created_by = stockflow_auth_uid()
        and stock_counts.status = 'open'
    )
  );

-- Submits a blind count: computes expected_quantity for every line from
-- stock_levels (the counter never saw this value) and marks the count
-- 'submitted'. A non-zero variance always needs
-- stockflow_approve_stock_count before it affects stock.
create or replace function public.stockflow_submit_stock_count(p_stock_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
begin
  select tenant_id, branch_id into v_tenant_id, v_branch_id
    from stock_counts
    where id = p_stock_count_id
      and tenant_id = stockflow_auth_tenant_id()
      and created_by = stockflow_auth_uid()
      and status = 'open';

  if v_tenant_id is null then
    raise exception 'stock count not found, not yours, or already submitted' using errcode = '42501';
  end if;

  update stock_count_lines l
    set expected_quantity = coalesce((
      select quantity from stock_levels sl
      where sl.tenant_id = v_tenant_id
        and sl.branch_id = v_branch_id
        and sl.product_id = l.product_id
    ), 0)
    where l.stock_count_id = p_stock_count_id;

  update stock_counts
    set status = 'submitted', submitted_at = now()
    where id = p_stock_count_id;
end;
$$;

grant execute on function public.stockflow_submit_stock_count(uuid) to authenticated;

-- Approves a submitted count: any line where counted <> expected becomes
-- a reason-coded 'count_variance' stock_movements row, atomically.
-- Owner/manager only.
create or replace function public.stockflow_approve_stock_count(p_stock_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_approver uuid := stockflow_auth_uid();
  v_device_id uuid;
  v_line record;
begin
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can approve a stock count' using errcode = '42501';
  end if;

  select tenant_id, branch_id into v_tenant_id, v_branch_id
    from stock_counts
    where id = p_stock_count_id
      and tenant_id = stockflow_auth_tenant_id()
      and status = 'submitted';

  if v_tenant_id is null then
    raise exception 'stock count not found, not yours to approve, or not submitted' using errcode = '42501';
  end if;

  select id into v_device_id from devices where staff_user_id = v_approver limit 1;
  if v_device_id is null then
    raise exception 'approving device is not registered' using errcode = '42501';
  end if;

  for v_line in
    select * from stock_count_lines where stock_count_id = p_stock_count_id
  loop
    if v_line.counted_quantity <> coalesce(v_line.expected_quantity, 0) then
      insert into stock_movements (
        tenant_id, branch_id, product_id, movement_type, quantity_delta,
        reason, actor_staff_user_id, device_id, operation_id
      ) values (
        v_tenant_id, v_branch_id, v_line.product_id, 'count_variance',
        v_line.counted_quantity - coalesce(v_line.expected_quantity, 0),
        'stock count ' || p_stock_count_id || ' variance, approved by ' || v_approver,
        v_approver, v_device_id, gen_random_uuid()
      );
    end if;
  end loop;

  update stock_counts
    set status = 'approved', approved_by = v_approver, approved_at = now()
    where id = p_stock_count_id;
end;
$$;

grant execute on function public.stockflow_approve_stock_count(uuid) to authenticated;
