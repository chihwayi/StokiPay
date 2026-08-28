-- Fixes stockflow_create_return (0008) to guard against over-returning
-- across multiple partial returns of the same sale item — the original
-- version only checked the return quantity against the sale item's
-- original quantity, not against how much of it had already been
-- returned, so the same line could be returned more than once for more
-- than was ever sold.

create or replace function public.stockflow_create_return(
  p_operation_id uuid,
  p_original_sale_id uuid,
  p_device_id uuid,
  p_reason text,
  p_refund_tender_type text,
  p_items jsonb -- [{sale_item_id, quantity}]
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
  v_return_id uuid;
  v_existing_return_id uuid;
  v_sale record;
  v_item jsonb;
  v_line record;
  v_line_total integer;
  v_already_returned integer;
  v_refund_amount_minor integer := 0;
  v_rate numeric(18, 8);
  v_rate_source text;
  v_rate_approved_by uuid;
  v_reporting_amount integer;
  v_open_session_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'return reason is required' using errcode = '22023';
  end if;

  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;

  select id into v_existing_return_id from returns
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing_return_id is not null then
    return v_existing_return_id;
  end if;

  select * into v_sale from sales where id = p_original_sale_id and tenant_id = v_tenant_id;
  if v_sale is null then
    raise exception 'original sale not found in this tenant' using errcode = '22023';
  end if;

  select reporting_currency into v_reporting_currency from tenants where id = v_tenant_id;

  v_return_id := gen_random_uuid();
  insert into returns (
    id, tenant_id, branch_id, original_sale_id, actor_staff_user_id, device_id, operation_id, reason
  ) values (
    v_return_id, v_tenant_id, v_sale.branch_id, p_original_sale_id, v_actor, p_device_id, p_operation_id, p_reason
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_line from sale_items
      where id = (v_item->>'sale_item_id')::uuid and tenant_id = v_tenant_id and sale_id = p_original_sale_id;
    if v_line is null then
      raise exception 'sale item % not found on this sale', v_item->>'sale_item_id' using errcode = '22023';
    end if;

    select coalesce(sum(quantity), 0) into v_already_returned
      from return_items where sale_item_id = v_line.id;

    if (v_item->>'quantity')::integer <= 0
      or (v_item->>'quantity')::integer > (v_line.quantity - v_already_returned) then
      raise exception 'invalid return quantity for sale item % (already returned %, of %)',
        v_item->>'sale_item_id', v_already_returned, v_line.quantity using errcode = '22023';
    end if;

    v_line_total := (v_item->>'quantity')::integer * v_line.unit_price_minor;
    v_refund_amount_minor := v_refund_amount_minor + v_line_total;

    insert into return_items (
      tenant_id, return_id, sale_item_id, product_id, quantity,
      unit_price_minor, currency_code, line_total_minor
    ) values (
      v_tenant_id, v_return_id, v_line.id, v_line.product_id, (v_item->>'quantity')::integer,
      v_line.unit_price_minor, v_line.currency_code, v_line_total
    );

    insert into stock_movements (
      tenant_id, branch_id, product_id, movement_type, quantity_delta,
      reason, actor_staff_user_id, device_id, operation_id
    ) values (
      v_tenant_id, v_sale.branch_id, v_line.product_id, 'return',
      (v_item->>'quantity')::integer, 'return ' || v_return_id, v_actor, p_device_id, gen_random_uuid()
    );
  end loop;

  if v_sale.currency_code = v_reporting_currency then
    v_rate := 1;
    v_rate_source := 'identity';
    v_rate_approved_by := null;
  else
    select rate, source, approved_by into v_rate, v_rate_source, v_rate_approved_by
      from exchange_rates
      where tenant_id = v_tenant_id
        and base_currency = v_sale.currency_code
        and quote_currency = v_reporting_currency
        and effective_from <= now()
      order by effective_from desc
      limit 1;
    if v_rate is null then
      raise exception 'no approved exchange rate for % -> %', v_sale.currency_code, v_reporting_currency
        using errcode = '22023';
    end if;
  end if;

  v_reporting_amount := round(v_refund_amount_minor * v_rate)::integer;

  select id into v_open_session_id from cash_sessions
    where tenant_id = v_tenant_id and branch_id = v_sale.branch_id and status = 'open';

  insert into payments (
    tenant_id, sale_id, return_id, cash_session_id, direction, tender_type,
    amount_minor, currency_code, exchange_rate_snapshot,
    reporting_currency_code, reporting_amount_minor, rate_source, rate_approved_by,
    actor_staff_user_id, device_id
  ) values (
    v_tenant_id, p_original_sale_id, v_return_id, v_open_session_id, 'out', p_refund_tender_type,
    v_refund_amount_minor, v_sale.currency_code, v_rate,
    v_reporting_currency, v_reporting_amount, v_rate_source, v_rate_approved_by,
    v_actor, p_device_id
  );

  return v_return_id;
end;
$$;
