-- Sprint 3 — Offline-Safe POS, Returns & Cash-up.
-- See sprints.md's Sprint 3 acceptance criteria, CLAUDE.md rules 1-5,
-- ADR 0003 (idempotency) and ADR 0004 (currency snapshot model).
--
-- Design notes:
--   * Every write in this file goes through a SECURITY DEFINER RPC, never
--     a direct RLS insert policy. Sale/return/cash-up creation is atomic,
--     multi-row, and needs server-computed exchange-rate snapshots that
--     plain RLS cannot express (same reasoning as Sprint 2's blind-count
--     RPCs).
--   * Exchange rates are never trusted from the client: every RPC here
--     resolves its own rate from the tenant's approved `exchange_rates`
--     table (or treats same-currency-as-reporting as an identity rate,
--     the one deliberate, documented exception to ADR 0004's "no special
--     case" guidance — an identity rate has no meaningful approval event).
--   * Two offline devices racing to sell the last unit of stock is
--     explicitly Sprint 6 scope (sprints.md's conflict-review acceptance
--     criterion) — this sprint does not block a sale on insufficient
--     stock.

alter table tenants add column cash_variance_threshold_minor integer not null default 200;

alter table cash_sessions enable row level security;
alter table cash_sessions force row level security;
alter table sales enable row level security;
alter table sales force row level security;
alter table sale_items enable row level security;
alter table sale_items force row level security;
alter table payments enable row level security;
alter table payments force row level security;
alter table returns enable row level security;
alter table returns force row level security;
alter table return_items enable row level security;
alter table return_items force row level security;
alter table cash_counts enable row level security;
alter table cash_counts force row level security;
alter table cash_variances enable row level security;
alter table cash_variances force row level security;

grant select, insert, update on cash_sessions to authenticated;
grant select on sales to authenticated;
grant select on sale_items to authenticated;
grant select on payments to authenticated;
grant select on returns to authenticated;
grant select on return_items to authenticated;
grant select on cash_counts to authenticated;
grant select on cash_variances to authenticated;

-- Idempotency contract (ADR 0003), scoped per tenant.
alter table sales add constraint sales_tenant_operation_unique
  unique (tenant_id, operation_id);
alter table returns add constraint returns_tenant_operation_unique
  unique (tenant_id, operation_id);
alter table payments add constraint payments_tenant_operation_unique
  unique (tenant_id, operation_id);

alter table payments add constraint payments_direction_check
  check (direction in ('in', 'out'));
alter table payments add constraint payments_tender_type_check
  check (tender_type in ('cash', 'mobile_money', 'card', 'bank_transfer'));
alter table cash_sessions add constraint cash_sessions_status_check
  check (status in ('open', 'closed'));

alter table payments add constraint payments_return_id_fkey
  foreign key (return_id) references returns (id);

-- Only one open till per branch at a time — a race-safe backstop for the
-- direct-insert "open session" policy below (no RPC needed to open,
-- since there's no computation to trust-boundary here, just this
-- uniqueness rule).
create unique index cash_sessions_one_open_per_branch
  on cash_sessions (tenant_id, branch_id)
  where status = 'open';

-- ---------------------------------------------------------------------
-- RLS: read policies (any tenant staff can see their tenant's records)
-- ---------------------------------------------------------------------

create policy cash_sessions_select_own_tenant on cash_sessions
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy sales_select_own_tenant on sales
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy sale_items_select_own_tenant on sale_items
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy payments_select_own_tenant on payments
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy returns_select_own_tenant on returns
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy return_items_select_own_tenant on return_items
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy cash_counts_select_own_tenant on cash_counts
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy cash_variances_select_own_tenant on cash_variances
  for select using (tenant_id = stockflow_auth_tenant_id());

-- Opening a till is a simple, non-computed insert — allowed directly via
-- RLS (device must belong to the opener; uniqueness index above is the
-- actual race-safety guarantee, not this policy).
create policy cash_sessions_insert_own on cash_sessions
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and opened_by = stockflow_auth_uid()
    and device_id in (select id from devices where staff_user_id = stockflow_auth_uid())
    and status = 'open'
  );

-- Closing is also a plain field update (status/closed_by/closed_at) —
-- the variance computation itself happens in stockflow_close_cash_session
-- below, which uses this same update internally.
create policy cash_sessions_update_close_own on cash_sessions
  for update
  using (tenant_id = stockflow_auth_tenant_id())
  with check (tenant_id = stockflow_auth_tenant_id());

-- sales / sale_items / payments / returns / return_items / cash_counts /
-- cash_variances have deliberately NO insert/update policy — every write
-- happens through a SECURITY DEFINER RPC below, which performs its own
-- tenant/device/actor checks before writing.

-- ---------------------------------------------------------------------
-- stockflow_create_sale: atomic, idempotent sale creation with split
-- tender across currencies. Stock is decremented via stock_movements in
-- the same transaction (function bodies are atomic — a raised exception
-- rolls back every insert made so far, satisfying "forced failure leaves
-- no partial server record").
-- ---------------------------------------------------------------------

create or replace function public.stockflow_create_sale(
  p_operation_id uuid,
  p_branch_id uuid,
  p_device_id uuid,
  p_currency_code text,
  p_items jsonb, -- [{product_id, quantity, unit_price_minor}]
  p_payments jsonb -- [{tender_type, amount_minor, currency_code}]
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
begin
  if v_tenant_id is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;

  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;

  -- Idempotent replay: a previously-seen operation_id is a no-op success.
  select id into v_existing_sale_id from sales
    where tenant_id = v_tenant_id and operation_id = p_operation_id;
  if v_existing_sale_id is not null then
    return v_existing_sale_id;
  end if;

  select reporting_currency into v_reporting_currency from tenants where id = v_tenant_id;

  -- Resolve the sale-level rate (currency_code -> reporting currency).
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

  -- Sum line items in sale currency first (all items share the sale's currency).
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

  -- Sale must be fully paid at commit time (credit sales are Sprint 4
  -- scope, per sprints.md). Small rounding tolerance for multi-line
  -- split-tender rate conversions.
  if abs(v_payments_reporting_sum - v_sale_reporting_amount) > 1 then
    raise exception 'payments (%) do not cover sale total (%)', v_payments_reporting_sum, v_sale_reporting_amount
      using errcode = '22023';
  end if;

  return v_sale_id;
end;
$$;

grant execute on function public.stockflow_create_sale(uuid, uuid, uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- stockflow_create_return: reversal record, never mutates the original
-- sale. Restocks via a positive stock_movements row and refunds via a
-- direction='out' payments row (single tender: the refund is paid back
-- via the tender_type given, which may differ from how the customer
-- originally paid — a full multi-tender-proportional refund split is a
-- documented simplification for this sprint, see docs/handoffs/sprint-3.md).
-- ---------------------------------------------------------------------

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
    if (v_item->>'quantity')::integer > v_line.quantity or (v_item->>'quantity')::integer <= 0 then
      raise exception 'invalid return quantity for sale item %', v_item->>'sale_item_id' using errcode = '22023';
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

grant execute on function public.stockflow_create_return(uuid, uuid, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- stockflow_close_cash_session: computes expected (opening float +
-- payments in - payments out, per tender/currency) vs counted, flags
-- over/short beyond the tenant's threshold as requiring manager review,
-- and requires a reason whenever a count line is flagged.
-- ---------------------------------------------------------------------

create or replace function public.stockflow_close_cash_session(
  p_cash_session_id uuid,
  p_counts jsonb -- [{tender_type, currency_code, counted_amount_minor, reason}]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
  v_actor uuid := stockflow_auth_uid();
  v_session record;
  v_threshold integer;
  v_count jsonb;
  v_expected integer;
  v_variance integer;
  v_requires_review boolean;
begin
  select * into v_session from cash_sessions
    where id = p_cash_session_id and tenant_id = v_tenant_id and status = 'open';
  if v_session is null then
    raise exception 'cash session not found, not yours, or already closed' using errcode = '42501';
  end if;

  select cash_variance_threshold_minor into v_threshold from tenants where id = v_tenant_id;

  for v_count in select * from jsonb_array_elements(p_counts)
  loop
    v_expected := coalesce((
      select sum(case when direction = 'in' then reporting_amount_minor else -reporting_amount_minor end)
      from payments
      where cash_session_id = p_cash_session_id
        and tender_type = (v_count->>'tender_type')
        and currency_code = (v_count->>'currency_code')
    ), 0);

    if (v_count->>'tender_type') = 'cash' and (v_count->>'currency_code') = v_session.opening_currency then
      v_expected := v_expected + v_session.opening_float_minor;
    end if;

    v_variance := (v_count->>'counted_amount_minor')::integer - v_expected;
    v_requires_review := abs(v_variance) > v_threshold;

    if v_requires_review and (v_count->>'reason' is null or length(trim(v_count->>'reason')) = 0) then
      raise exception 'a reason is required for % % variance of % (threshold %)',
        v_count->>'currency_code', v_count->>'tender_type', v_variance, v_threshold
        using errcode = '22023';
    end if;

    insert into cash_counts (
      tenant_id, cash_session_id, tender_type, currency_code, counted_amount_minor
    ) values (
      v_tenant_id, p_cash_session_id, v_count->>'tender_type', v_count->>'currency_code',
      (v_count->>'counted_amount_minor')::integer
    );

    insert into cash_variances (
      tenant_id, cash_session_id, tender_type, currency_code,
      expected_amount_minor, counted_amount_minor, variance_minor, reason, requires_review
    ) values (
      v_tenant_id, p_cash_session_id, v_count->>'tender_type', v_count->>'currency_code',
      v_expected, (v_count->>'counted_amount_minor')::integer, v_variance, v_count->>'reason', v_requires_review
    );
  end loop;

  update cash_sessions
    set status = 'closed', closed_by = v_actor, closed_at = now()
    where id = p_cash_session_id;
end;
$$;

grant execute on function public.stockflow_close_cash_session(uuid, jsonb) to authenticated;

-- Manager sign-off on a flagged variance. Owner/manager only.
create or replace function public.stockflow_review_cash_variance(p_cash_variance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
begin
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can review a cash variance' using errcode = '42501';
  end if;

  update cash_variances
    set reviewed_by = stockflow_auth_uid(), reviewed_at = now()
    where id = p_cash_variance_id and tenant_id = v_tenant_id and requires_review = true and reviewed_at is null;

  if not found then
    raise exception 'cash variance not found, not yours, or already reviewed' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.stockflow_review_cash_variance(uuid) to authenticated;

-- stock_movements.movement_type CHECK from Sprint 2 needs 'sale' and
-- 'return' added.
alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in ('receipt', 'adjustment', 'count_variance', 'sale', 'return'));

-- The Sprint 2 "reason required for non-receipt movements" constraint
-- would otherwise block 'sale' movements (no per-line reason makes
-- sense for an ordinary sale) — narrow it to adjustment/count_variance.
alter table stock_movements drop constraint stock_movements_reason_required_for_adjustment;
alter table stock_movements add constraint stock_movements_reason_required_for_adjustment
  check (movement_type in ('receipt', 'sale') or (reason is not null and length(trim(reason)) > 0));
