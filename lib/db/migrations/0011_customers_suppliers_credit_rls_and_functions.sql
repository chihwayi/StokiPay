-- Sprint 4 RLS, constraints, and privileged functions for customers,
-- suppliers, credit sales, repayments, purchase orders/receiving.
-- See sprints.md's Sprint 4 acceptance criteria and CLAUDE.md rules 1-5.

alter table customers enable row level security;
alter table customers force row level security;
alter table customer_ledger enable row level security;
alter table customer_ledger force row level security;
alter table suppliers enable row level security;
alter table suppliers force row level security;
alter table supplier_ledger enable row level security;
alter table supplier_ledger force row level security;
alter table purchase_orders enable row level security;
alter table purchase_orders force row level security;
alter table purchase_order_lines enable row level security;
alter table purchase_order_lines force row level security;
alter table purchase_receipts enable row level security;
alter table purchase_receipts force row level security;
alter table purchase_receipt_lines enable row level security;
alter table purchase_receipt_lines force row level security;
alter table provider_payments enable row level security;
alter table provider_payments force row level security;
alter table provider_webhook_log enable row level security;
alter table provider_webhook_log force row level security;

grant select, insert, update on customers to authenticated;
grant select on customer_ledger to authenticated;
grant select, insert, update on suppliers to authenticated;
grant select on supplier_ledger to authenticated;
grant select on purchase_orders to authenticated;
grant select on purchase_order_lines to authenticated;
grant select on purchase_receipts to authenticated;
grant select on purchase_receipt_lines to authenticated;
grant select on provider_payments to authenticated;

-- Idempotency contract (ADR 0003), scoped per tenant.
alter table customer_ledger add constraint customer_ledger_tenant_operation_unique
  unique (tenant_id, operation_id);
alter table supplier_ledger add constraint supplier_ledger_tenant_operation_unique
  unique (tenant_id, operation_id);
alter table purchase_receipts add constraint purchase_receipts_tenant_operation_unique
  unique (tenant_id, operation_id);

alter table customer_ledger add constraint customer_ledger_entry_type_check
  check (entry_type in ('credit_sale', 'payment', 'adjustment'));
alter table supplier_ledger add constraint supplier_ledger_entry_type_check
  check (entry_type in ('purchase', 'payment', 'adjustment'));
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('submitted', 'received'));
alter table provider_payments add constraint provider_payments_status_check
  check (status in ('initiated', 'confirmed', 'failed', 'cancelled'));

-- Every payment is attributable to exactly one of a sale, a standalone
-- customer repayment, or a standalone supplier payment.
alter table payments add constraint payments_exactly_one_reference_check
  check (
    (case when sale_id is not null then 1 else 0 end)
    + (case when customer_id is not null then 1 else 0 end)
    + (case when supplier_id is not null then 1 else 0 end)
    = 1
  );

-- customers / suppliers: any tenant staff can see and create; only
-- owner/manager can edit (mirrors the products "rate role" pattern from
-- Sprint 2 — customer/supplier records affect credit exposure).
create policy customers_select_own_tenant on customers
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy customers_insert_own_tenant on customers
  for insert with check (tenant_id = stockflow_auth_tenant_id());
create policy customers_update_owner_manager on customers
  for update
  using (tenant_id = stockflow_auth_tenant_id() and stockflow_auth_role() in ('owner', 'manager'))
  with check (tenant_id = stockflow_auth_tenant_id());

create policy suppliers_select_own_tenant on suppliers
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy suppliers_insert_own_tenant on suppliers
  for insert with check (tenant_id = stockflow_auth_tenant_id());
create policy suppliers_update_owner_manager on suppliers
  for update
  using (tenant_id = stockflow_auth_tenant_id() and stockflow_auth_role() in ('owner', 'manager'))
  with check (tenant_id = stockflow_auth_tenant_id());

-- Ledgers, purchase orders/receipts and provider payments: read-only
-- under RLS, every write goes through a SECURITY DEFINER RPC below —
-- same reasoning as Sprint 2/3 (rate resolution, idempotency, atomic
-- multi-row writes that plain RLS can't express).
create policy customer_ledger_select_own_tenant on customer_ledger
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy supplier_ledger_select_own_tenant on supplier_ledger
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy purchase_orders_select_own_tenant on purchase_orders
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy purchase_order_lines_select_own_tenant on purchase_order_lines
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy purchase_receipts_select_own_tenant on purchase_receipts
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy purchase_receipt_lines_select_own_tenant on purchase_receipt_lines
  for select using (tenant_id = stockflow_auth_tenant_id());
create policy provider_payments_select_own_tenant on provider_payments
  for select using (tenant_id = stockflow_auth_tenant_id());
-- provider_webhook_log has no tenant_id (a webhook may not resolve to a
-- known provider_payment at all if the signature is invalid) — no select
-- policy, so no authenticated tenant user can read it via PostgREST;
-- it exists purely as a server-side audit trail read via DATABASE_URL.

-- ---------------------------------------------------------------------
-- stockflow_create_sale is extended (Sprint 3, migration 0008) to accept
-- an optional customer for credit sales: payments may fall short of the
-- sale total, and the shortfall becomes a customer_ledger 'credit_sale'
-- entry instead of being rejected. Backward compatible: p_customer_id
-- defaults to null, in which case behavior is unchanged from Sprint 3
-- (payments must fully cover the sale).
-- ---------------------------------------------------------------------

create or replace function public.stockflow_create_sale(
  p_operation_id uuid,
  p_branch_id uuid,
  p_device_id uuid,
  p_currency_code text,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
  v_actor uuid := stockflow_auth_uid();
  v_reporting_currency text;
  v_sale_id uuid;
  v_existing_sale_id uuid;
  v_item jsonb;
  v_payment jsonb;
  v_line_total integer;
  v_sale_amount_minor integer := 0;
  v_rate numeric(18, 8);
  v_rate_source text;
  v_rate_approved_by uuid;
  v_reporting_amount integer;
  v_sale_reporting_amount integer;
  v_payments_reporting_sum integer := 0;
  v_open_session_id uuid;
  v_cost_price integer;
  v_shortfall integer;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;

  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from customers where id = p_customer_id and tenant_id = v_tenant_id
  ) then
    raise exception 'customer not found in this tenant' using errcode = '22023';
  end if;

  select id into v_existing_sale_id from sales
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing_sale_id is not null then
    return v_existing_sale_id;
  end if;

  select reporting_currency into v_reporting_currency from tenants where id = v_tenant_id;

  if p_currency_code = v_reporting_currency then
    v_rate := 1;
    v_rate_source := 'identity';
    v_rate_approved_by := null;
  else
    select rate, source, approved_by into v_rate, v_rate_source, v_rate_approved_by
      from exchange_rates
      where tenant_id = v_tenant_id
        and base_currency = p_currency_code
        and quote_currency = v_reporting_currency
        and effective_from <= now()
      order by effective_from desc
      limit 1;
    if v_rate is null then
      raise exception 'no approved exchange rate for % -> %', p_currency_code, v_reporting_currency
        using errcode = '22023';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line_total := (v_item->>'quantity')::integer * (v_item->>'unit_price_minor')::integer;
    v_sale_amount_minor := v_sale_amount_minor + v_line_total;
  end loop;

  if v_sale_amount_minor <= 0 then
    raise exception 'sale must have at least one positive-value item' using errcode = '22023';
  end if;

  v_sale_reporting_amount := round(v_sale_amount_minor * v_rate)::integer;

  v_sale_id := gen_random_uuid();
  insert into sales (
    id, tenant_id, branch_id, cashier_staff_user_id, device_id, operation_id,
    amount_minor, currency_code, exchange_rate_snapshot,
    reporting_currency_code, reporting_amount_minor, rate_source, rate_approved_by
  ) values (
    v_sale_id, v_tenant_id, p_branch_id, v_actor, p_device_id, p_operation_id,
    v_sale_amount_minor, p_currency_code, v_rate,
    v_reporting_currency, v_sale_reporting_amount, v_rate_source, v_rate_approved_by
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line_total := (v_item->>'quantity')::integer * (v_item->>'unit_price_minor')::integer;

    select cost_price_minor into v_cost_price from products
      where id = (v_item->>'product_id')::uuid and tenant_id = v_tenant_id;
    if v_cost_price is null then
      raise exception 'product % not found in this tenant', v_item->>'product_id' using errcode = '22023';
    end if;

    insert into sale_items (
      tenant_id, sale_id, product_id, quantity, unit_price_minor,
      currency_code, line_total_minor, unit_cost_price_minor
    ) values (
      v_tenant_id, v_sale_id, (v_item->>'product_id')::uuid, (v_item->>'quantity')::integer,
      (v_item->>'unit_price_minor')::integer, p_currency_code, v_line_total, v_cost_price
    );

    insert into stock_movements (
      tenant_id, branch_id, product_id, movement_type, quantity_delta,
      reason, actor_staff_user_id, device_id, operation_id
    ) values (
      v_tenant_id, p_branch_id, (v_item->>'product_id')::uuid, 'sale',
      -1 * (v_item->>'quantity')::integer, null, v_actor, p_device_id, gen_random_uuid()
    );
  end loop;

  select id into v_open_session_id from cash_sessions
    where tenant_id = v_tenant_id and branch_id = p_branch_id and status = 'open';

  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    if (v_payment->>'currency_code') = v_reporting_currency then
      v_rate := 1;
      v_rate_source := 'identity';
      v_rate_approved_by := null;
    else
      select rate, source, approved_by into v_rate, v_rate_source, v_rate_approved_by
        from exchange_rates
        where tenant_id = v_tenant_id
          and base_currency = (v_payment->>'currency_code')
          and quote_currency = v_reporting_currency
          and effective_from <= now()
        order by effective_from desc
        limit 1;
      if v_rate is null then
        raise exception 'no approved exchange rate for % -> %', v_payment->>'currency_code', v_reporting_currency
          using errcode = '22023';
      end if;
    end if;

    v_reporting_amount := round((v_payment->>'amount_minor')::integer * v_rate)::integer;
    v_payments_reporting_sum := v_payments_reporting_sum + v_reporting_amount;

    insert into payments (
      tenant_id, sale_id, cash_session_id, direction, tender_type,
      amount_minor, currency_code, exchange_rate_snapshot,
      reporting_currency_code, reporting_amount_minor, rate_source, rate_approved_by,
      actor_staff_user_id, device_id
    ) values (
      v_tenant_id, v_sale_id, v_open_session_id, 'in', v_payment->>'tender_type',
      (v_payment->>'amount_minor')::integer, v_payment->>'currency_code', v_rate,
      v_reporting_currency, v_reporting_amount, v_rate_source, v_rate_approved_by,
      v_actor, p_device_id
    );
  end loop;

  v_shortfall := v_sale_reporting_amount - v_payments_reporting_sum;

  if v_shortfall > 1 then
    if p_customer_id is null then
      raise exception 'payments (%) do not cover sale total (%)', v_payments_reporting_sum, v_sale_reporting_amount
        using errcode = '22023';
    end if;

    insert into customer_ledger (
      tenant_id, customer_id, entry_type, amount_minor, currency_code,
      exchange_rate_snapshot, reporting_currency_code, reporting_amount_minor,
      rate_source, reference_sale_id, actor_staff_user_id, device_id, operation_id
    ) values (
      v_tenant_id, p_customer_id, 'credit_sale', v_shortfall, v_reporting_currency,
      1, v_reporting_currency, v_shortfall,
      'sale_shortfall', v_sale_id, v_actor, p_device_id, gen_random_uuid()
    );
  elsif v_shortfall < -1 then
    raise exception 'payments (%) exceed sale total (%)', v_payments_reporting_sum, v_sale_reporting_amount
      using errcode = '22023';
  end if;

  return v_sale_id;
end;
$$;

grant execute on function public.stockflow_create_sale(uuid, uuid, uuid, text, jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- stockflow_record_customer_payment: a standalone debt repayment, not
-- tied to a specific sale. Creates both a payments row (direction='in',
-- so it flows into cash-up reconciliation like any other tender) and a
-- customer_ledger 'payment' entry (negative, reducing the balance)
-- referencing it — never edits a prior ledger entry (CLAUDE.md rule 2).
-- ---------------------------------------------------------------------

create or replace function public.stockflow_record_customer_payment(
  p_operation_id uuid,
  p_customer_id uuid,
  p_device_id uuid,
  p_amount_minor integer,
  p_currency_code text,
  p_tender_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
  v_actor uuid := stockflow_auth_uid();
  v_reporting_currency text;
  v_rate numeric(18, 8);
  v_rate_source text;
  v_rate_approved_by uuid;
  v_reporting_amount integer;
  v_payment_id uuid;
  v_existing uuid;
  v_open_session_id uuid;
  v_branch_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;
  if not exists (select 1 from customers where id = p_customer_id and tenant_id = v_tenant_id) then
    raise exception 'customer not found in this tenant' using errcode = '22023';
  end if;

  select id into v_existing from customer_ledger
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing is not null then
    return v_existing;
  end if;

  select reporting_currency into v_reporting_currency from tenants where id = v_tenant_id;

  if p_currency_code = v_reporting_currency then
    v_rate := 1;
    v_rate_source := 'identity';
    v_rate_approved_by := null;
  else
    select rate, source, approved_by into v_rate, v_rate_source, v_rate_approved_by
      from exchange_rates
      where tenant_id = v_tenant_id and base_currency = p_currency_code
        and quote_currency = v_reporting_currency and effective_from <= now()
      order by effective_from desc limit 1;
    if v_rate is null then
      raise exception 'no approved exchange rate for % -> %', p_currency_code, v_reporting_currency
        using errcode = '22023';
    end if;
  end if;

  v_reporting_amount := round(p_amount_minor * v_rate)::integer;

  select branch_id into v_branch_id from staff_users where id = v_actor;
  select id into v_open_session_id from cash_sessions
    where tenant_id = v_tenant_id and branch_id = v_branch_id and status = 'open';

  insert into payments (
    tenant_id, customer_id, cash_session_id, direction, tender_type,
    amount_minor, currency_code, exchange_rate_snapshot,
    reporting_currency_code, reporting_amount_minor, rate_source, rate_approved_by,
    actor_staff_user_id, device_id
  ) values (
    v_tenant_id, p_customer_id, v_open_session_id, 'in', p_tender_type,
    p_amount_minor, p_currency_code, v_rate,
    v_reporting_currency, v_reporting_amount, v_rate_source, v_rate_approved_by,
    v_actor, p_device_id
  ) returning id into v_payment_id;

  insert into customer_ledger (
    tenant_id, customer_id, entry_type, amount_minor, currency_code,
    exchange_rate_snapshot, reporting_currency_code, reporting_amount_minor,
    rate_source, rate_approved_by, reference_payment_id,
    actor_staff_user_id, device_id, operation_id
  ) values (
    v_tenant_id, p_customer_id, 'payment', -p_amount_minor, p_currency_code,
    v_rate, v_reporting_currency, -v_reporting_amount,
    v_rate_source, v_rate_approved_by, v_payment_id,
    v_actor, p_device_id, p_operation_id
  );

  return v_payment_id;
end;
$$;

grant execute on function public.stockflow_record_customer_payment(uuid, uuid, uuid, integer, text, text) to authenticated;
