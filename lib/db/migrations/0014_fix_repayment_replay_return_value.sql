-- Fixes stockflow_record_customer_payment and stockflow_pay_supplier:
-- on first call they returned the new payments.id, but on an idempotent
-- replay they returned the ledger entry's own id instead — two different
-- ids for what should be the same logical "this payment" identity,
-- caught by tests/integration/customers-suppliers.test.ts's replay test.
-- Both paths now consistently return the payments.id.

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
  v_existing_payment_id uuid;
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

  select reference_payment_id into v_existing_payment_id from customer_ledger
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing_payment_id is not null then
    return v_existing_payment_id;
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
  v_existing_payment_id uuid;
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

  select reference_payment_id into v_existing_payment_id from supplier_ledger
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing_payment_id is not null then
    return v_existing_payment_id;
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
