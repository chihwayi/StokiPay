-- Sprint 6: multi-device stock conflict detection. Two offline devices
-- can each independently commit a sale against the same physical last
-- unit — by the time both sync, the goods are already gone to two
-- different customers, so neither sale is rejected retroactively
-- (CLAUDE.md rule 2). What must never happen is *silent* negative
-- stock: stockflow_create_sale now checks, after each line's stock
-- movement, whether stock_levels for that product/branch went below
-- zero, and if so inserts a visible stock_conflicts row for owner
-- review — the sale itself still completes normally.

alter table stock_conflicts enable row level security;
alter table stock_conflicts force row level security;

grant select on stock_conflicts to authenticated;

create policy stock_conflicts_select_own_tenant on stock_conflicts
  for select using (tenant_id = stockflow_auth_tenant_id());

-- No insert/update policy — stockflow_create_sale (below) inserts
-- conflicts, and stockflow_resolve_stock_conflict (below) is the only
-- way to mark one resolved.

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
  v_movement_id uuid;
  v_resulting_quantity integer;
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
    ) returning id into v_movement_id;

    -- Multi-device conflict detection (Sprint 6): this sale's own write
    -- might be the second of two concurrent sales against the same last
    -- unit. Never block or roll back the sale over it — the goods are
    -- already gone in the physical world — just make it visible.
    select quantity into v_resulting_quantity from stock_levels
      where tenant_id = v_tenant_id and branch_id = p_branch_id and product_id = (v_item->>'product_id')::uuid;

    if coalesce(v_resulting_quantity, 0) < 0 then
      insert into stock_conflicts (
        tenant_id, branch_id, product_id, stock_movement_id, resulting_quantity
      ) values (
        v_tenant_id, p_branch_id, (v_item->>'product_id')::uuid, v_movement_id, v_resulting_quantity
      );
    end if;
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

-- Owner/manager sign-off that a negative-stock conflict has been
-- investigated (e.g. physical recount, supplier reorder placed).
create or replace function public.stockflow_resolve_stock_conflict(
  p_conflict_id uuid,
  p_resolution_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
begin
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can resolve a stock conflict' using errcode = '42501';
  end if;
  if p_resolution_note is null or length(trim(p_resolution_note)) = 0 then
    raise exception 'a resolution note is required' using errcode = '22023';
  end if;

  update stock_conflicts
    set resolved = true, resolution_note = p_resolution_note,
        resolved_by = stockflow_auth_uid(), resolved_at = now()
    where id = p_conflict_id and tenant_id = v_tenant_id and resolved = false;

  if not found then
    raise exception 'stock conflict not found, not yours, or already resolved' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.stockflow_resolve_stock_conflict(uuid, text) to authenticated;
