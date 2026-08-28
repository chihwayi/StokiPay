-- Sprint 4: Paynow reconciliation. payments.actor_staff_user_id/device_id
-- relaxed to nullable — a provider-reconciled payment (customer paid via
-- a Paynow link, not a staff member at a till) has neither. The
-- payments_exactly_one_reference_check constraint (0011) still requires
-- exactly one of sale_id/customer_id/supplier_id, so every payment row
-- remains attributable to something even when actor/device are null.

alter table payments alter column actor_staff_user_id drop not null;
alter table payments alter column device_id drop not null;

-- provider_payments RLS was already enabled in migration 0011.

-- Transitions a provider_payments row after a *verified* webhook or a
-- poll confirms a 'Paid' status. Runs with the service role (invoked
-- from app/api/payments/paynow-webhook/route.ts using
-- SUPABASE_SERVICE_ROLE_KEY, not a staff JWT — there is no signed-in
-- staff member in a webhook request) so it cannot use
-- stockflow_auth_tenant_id()/stockflow_auth_uid(); it trusts its caller
-- the same way the webhook route itself must be trusted (service-role
-- key only ever lives server-side, never shipped to a browser).
-- Idempotent: a duplicate webhook for an already-'confirmed' payment is
-- a no-op — it does not create a second payments row or re-fire the
-- ledger effect (sprints.md's "duplicate webhook changes nothing").
create or replace function public.stockflow_reconcile_provider_payment(
  p_provider_payment_id uuid,
  p_new_status text -- 'confirmed' | 'failed' | 'cancelled'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp record;
  v_reporting_currency text;
  v_rate numeric(18, 8);
  v_rate_source text;
  v_reporting_amount integer;
  v_payment_id uuid;
begin
  if p_new_status not in ('confirmed', 'failed', 'cancelled') then
    raise exception 'invalid status %', p_new_status using errcode = '22023';
  end if;

  select * into v_pp from provider_payments where id = p_provider_payment_id for update;
  if v_pp is null then
    raise exception 'provider payment not found' using errcode = '22023';
  end if;

  -- Already in a terminal state — duplicate webhook/poll is a no-op.
  if v_pp.status in ('confirmed', 'failed', 'cancelled') then
    return v_pp.resulting_payment_id;
  end if;

  if p_new_status = 'confirmed' then
    select reporting_currency into v_reporting_currency from tenants where id = v_pp.tenant_id;
    if v_pp.currency_code = v_reporting_currency then
      v_rate := 1;
      v_rate_source := 'identity';
    else
      select rate, source into v_rate, v_rate_source
        from exchange_rates
        where tenant_id = v_pp.tenant_id and base_currency = v_pp.currency_code
          and quote_currency = v_reporting_currency and effective_from <= now()
        order by effective_from desc limit 1;
      if v_rate is null then
        raise exception 'no approved exchange rate for % -> %', v_pp.currency_code, v_reporting_currency
          using errcode = '22023';
      end if;
    end if;
    v_reporting_amount := round(v_pp.amount_minor * v_rate)::integer;

    insert into payments (
      tenant_id, sale_id, customer_id, direction, tender_type,
      amount_minor, currency_code, exchange_rate_snapshot,
      reporting_currency_code, reporting_amount_minor, rate_source,
      actor_staff_user_id, device_id
    ) values (
      v_pp.tenant_id, v_pp.sale_id, case when v_pp.sale_id is null then v_pp.customer_id else null end,
      'in', 'mobile_money',
      v_pp.amount_minor, v_pp.currency_code, v_rate,
      v_reporting_currency, v_reporting_amount, v_rate_source,
      null, null
    ) returning id into v_payment_id;

    update provider_payments
      set status = 'confirmed', resulting_payment_id = v_payment_id
      where id = p_provider_payment_id;

    return v_payment_id;
  end if;

  update provider_payments set status = p_new_status where id = p_provider_payment_id;
  return null;
end;
$$;

-- Deliberately no `grant execute ... to authenticated` — this function
-- is invoked only via the service-role Postgres connection from the
-- webhook route, never by an ordinary signed-in staff member.
grant execute on function public.stockflow_reconcile_provider_payment(uuid, text) to service_role;
