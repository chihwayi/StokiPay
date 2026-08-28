-- Sprint 4: purchase orders, receiving (with discrepancy tracking and
-- proportionally-allocated landed cost), and standalone supplier
-- payments. See sprints.md's Sprint 4 acceptance criteria.

-- Only owner/manager can create a purchase order (spends the business's
-- money / creates supplier exposure — same privilege tier as the
-- Sprint 2 "rate role").
create or replace function public.stockflow_create_purchase_order(
  p_branch_id uuid,
  p_supplier_id uuid,
  p_lines jsonb -- [{product_id, quantity_ordered, unit_cost_minor, currency_code}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
  v_actor uuid := stockflow_auth_uid();
  v_po_id uuid;
  v_line jsonb;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can create a purchase order' using errcode = '42501';
  end if;
  if not exists (select 1 from suppliers where id = p_supplier_id and tenant_id = v_tenant_id) then
    raise exception 'supplier not found in this tenant' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'a purchase order needs at least one line' using errcode = '22023';
  end if;

  v_po_id := gen_random_uuid();
  insert into purchase_orders (id, tenant_id, branch_id, supplier_id, status, created_by)
    values (v_po_id, v_tenant_id, p_branch_id, p_supplier_id, 'submitted', v_actor);

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if not exists (select 1 from products where id = (v_line->>'product_id')::uuid and tenant_id = v_tenant_id) then
      raise exception 'product % not found in this tenant', v_line->>'product_id' using errcode = '22023';
    end if;
    insert into purchase_order_lines (
      tenant_id, purchase_order_id, product_id, quantity_ordered, unit_cost_minor, currency_code
    ) values (
      v_tenant_id, v_po_id, (v_line->>'product_id')::uuid,
      (v_line->>'quantity_ordered')::integer, (v_line->>'unit_cost_minor')::integer, v_line->>'currency_code'
    );
  end loop;

  return v_po_id;
end;
$$;

grant execute on function public.stockflow_create_purchase_order(uuid, uuid, jsonb) to authenticated;

-- Receives a purchase order: records what was actually received per
-- line (which may differ from what was ordered — the discrepancy is
-- just quantity_ordered vs quantity_received sitting side by side on
-- purchase_receipt_lines, not a separate flag), allocates freight/other
-- landed costs proportionally by received value across lines, updates
-- products.cost_price_minor going forward only (already-completed sales
-- keep their own unit_cost_price_minor snapshot from Sprint 3 — this
-- never rewrites historic profit, satisfying Sprint 5's requirement
-- before Sprint 5 even starts), and posts one supplier_ledger 'purchase'
-- entry for the full landed cost.
create or replace function public.stockflow_receive_purchase_order(
  p_operation_id uuid,
  p_purchase_order_id uuid,
  p_device_id uuid,
  p_lines jsonb, -- [{product_id, quantity_received}]
  p_freight_cost_minor integer,
  p_other_cost_minor integer,
  p_currency_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
  v_actor uuid := stockflow_auth_uid();
  v_po record;
  v_existing_receipt uuid;
  v_receipt_id uuid;
  v_line jsonb;
  v_po_line record;
  v_total_base_value integer := 0;
  v_extra_cost integer;
  v_base_value integer;
  v_allocated_extra integer;
  v_landed_unit_cost integer;
  v_total_landed_cost integer := 0;
  v_reporting_currency text;
  v_rate numeric(18, 8);
  v_rate_source text;
  v_rate_approved_by uuid;
  v_reporting_amount integer;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;
  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;

  select id into v_existing_receipt from purchase_receipts
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing_receipt is not null then
    return v_existing_receipt;
  end if;

  select * into v_po from purchase_orders
    where id = p_purchase_order_id and tenant_id = v_tenant_id and status = 'submitted';
  if v_po is null then
    raise exception 'purchase order not found, not yours, or already received' using errcode = '22023';
  end if;

  v_extra_cost := coalesce(p_freight_cost_minor, 0) + coalesce(p_other_cost_minor, 0);

  -- First pass: total base (pre-allocation) value of what's actually
  -- being received, to compute each line's proportional share.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_po_line from purchase_order_lines
      where purchase_order_id = p_purchase_order_id and product_id = (v_line->>'product_id')::uuid;
    if v_po_line is null then
      raise exception 'product % is not on this purchase order', v_line->>'product_id' using errcode = '22023';
    end if;
    v_total_base_value := v_total_base_value + (v_line->>'quantity_received')::integer * v_po_line.unit_cost_minor;
  end loop;

  v_receipt_id := gen_random_uuid();
  insert into purchase_receipts (
    id, tenant_id, purchase_order_id, branch_id, freight_cost_minor, other_cost_minor,
    currency_code, received_by, device_id, operation_id
  ) values (
    v_receipt_id, v_tenant_id, p_purchase_order_id, v_po.branch_id, coalesce(p_freight_cost_minor, 0),
    coalesce(p_other_cost_minor, 0), p_currency_code, v_actor, p_device_id, p_operation_id
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_po_line from purchase_order_lines
      where purchase_order_id = p_purchase_order_id and product_id = (v_line->>'product_id')::uuid;

    v_base_value := (v_line->>'quantity_received')::integer * v_po_line.unit_cost_minor;
    v_allocated_extra := case
      when v_total_base_value > 0 then round((v_base_value::numeric / v_total_base_value) * v_extra_cost)::integer
      else 0
    end;
    v_landed_unit_cost := case
      when (v_line->>'quantity_received')::integer > 0
        then v_po_line.unit_cost_minor + (v_allocated_extra / (v_line->>'quantity_received')::integer)
      else v_po_line.unit_cost_minor
    end;

    insert into purchase_receipt_lines (
      tenant_id, purchase_receipt_id, product_id, quantity_ordered, quantity_received,
      landed_unit_cost_minor, currency_code
    ) values (
      v_tenant_id, v_receipt_id, v_po_line.product_id, v_po_line.quantity_ordered,
      (v_line->>'quantity_received')::integer, v_landed_unit_cost, p_currency_code
    );

    if (v_line->>'quantity_received')::integer > 0 then
      insert into stock_movements (
        tenant_id, branch_id, product_id, movement_type, quantity_delta,
        reason, actor_staff_user_id, device_id, operation_id
      ) values (
        v_tenant_id, v_po.branch_id, v_po_line.product_id, 'receipt',
        (v_line->>'quantity_received')::integer, null, v_actor, p_device_id, gen_random_uuid()
      );

      update products set cost_price_minor = v_landed_unit_cost, updated_at = now()
        where id = v_po_line.product_id and tenant_id = v_tenant_id;
    end if;

    v_total_landed_cost := v_total_landed_cost + v_base_value + v_allocated_extra;
  end loop;

  update purchase_orders set status = 'received' where id = p_purchase_order_id;

  if v_total_landed_cost > 0 then
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
    v_reporting_amount := round(v_total_landed_cost * v_rate)::integer;

    insert into supplier_ledger (
      tenant_id, supplier_id, entry_type, amount_minor, currency_code,
      exchange_rate_snapshot, reporting_currency_code, reporting_amount_minor,
      rate_source, rate_approved_by, reference_purchase_receipt_id,
      actor_staff_user_id, device_id, operation_id
    ) values (
      v_tenant_id, v_po.supplier_id, 'purchase', v_total_landed_cost, p_currency_code,
      v_rate, v_reporting_currency, v_reporting_amount,
      v_rate_source, v_rate_approved_by, v_receipt_id,
      v_actor, p_device_id, gen_random_uuid()
    );
  end if;

  return v_receipt_id;
end;
$$;

grant execute on function public.stockflow_receive_purchase_order(uuid, uuid, uuid, jsonb, integer, integer, text) to authenticated;

-- Mirrors stockflow_record_customer_payment: a standalone payment to a
-- supplier, flows into cash-up reconciliation via payments (direction
-- 'out'), reduces the supplier balance via a negative supplier_ledger row.
create or replace function public.stockflow_pay_supplier(
  p_operation_id uuid,
  p_supplier_id uuid,
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
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can pay a supplier' using errcode = '42501';
  end if;
  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;
  if not exists (select 1 from suppliers where id = p_supplier_id and tenant_id = v_tenant_id) then
    raise exception 'supplier not found in this tenant' using errcode = '22023';
  end if;

  select id into v_existing from supplier_ledger
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
    tenant_id, supplier_id, cash_session_id, direction, tender_type,
    amount_minor, currency_code, exchange_rate_snapshot,
    reporting_currency_code, reporting_amount_minor, rate_source, rate_approved_by,
    actor_staff_user_id, device_id
  ) values (
    v_tenant_id, p_supplier_id, v_open_session_id, 'out', p_tender_type,
    p_amount_minor, p_currency_code, v_rate,
    v_reporting_currency, v_reporting_amount, v_rate_source, v_rate_approved_by,
    v_actor, p_device_id
  ) returning id into v_payment_id;

  insert into supplier_ledger (
    tenant_id, supplier_id, entry_type, amount_minor, currency_code,
    exchange_rate_snapshot, reporting_currency_code, reporting_amount_minor,
    rate_source, rate_approved_by, reference_payment_id,
    actor_staff_user_id, device_id, operation_id
  ) values (
    v_tenant_id, p_supplier_id, 'payment', -p_amount_minor, p_currency_code,
    v_rate, v_reporting_currency, -v_reporting_amount,
    v_rate_source, v_rate_approved_by, v_payment_id,
    v_actor, p_device_id, p_operation_id
  );

  return v_payment_id;
end;
$$;

grant execute on function public.stockflow_pay_supplier(uuid, uuid, uuid, integer, text, text) to authenticated;
