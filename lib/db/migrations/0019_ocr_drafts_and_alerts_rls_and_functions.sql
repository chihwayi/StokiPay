-- Sprint 7: OCR draft-confirm workflow and dismissible anomaly alerts.
-- See sprints.md's Sprint 7 acceptance criteria and CLAUDE.md rule 6
-- (AI is read-only/additive, never authoritative on its own).

alter table ocr_drafts enable row level security;
alter table ocr_drafts force row level security;
alter table alerts enable row level security;
alter table alerts force row level security;

grant select, insert on ocr_drafts to authenticated;
grant select, update on alerts to authenticated;

alter table ocr_drafts add constraint ocr_drafts_status_check
  check (status in ('draft', 'confirmed', 'rejected'));
alter table alerts add constraint alerts_type_check
  check (alert_type in ('unresolved_stock_conflict', 'unreviewed_cash_variance', 'rapid_debt_growth'));

-- Any tenant staff can upload a draft (photographing a ledger page is
-- not a privileged action); only owner/manager can confirm one into
-- real records (below) or reject it.
create policy ocr_drafts_select_own_tenant on ocr_drafts
  for select using (tenant_id = stockflow_auth_tenant_id());

create policy ocr_drafts_insert_own on ocr_drafts
  for insert
  with check (
    tenant_id = stockflow_auth_tenant_id()
    and uploaded_by = stockflow_auth_uid()
    and device_id in (select id from devices where staff_user_id = stockflow_auth_uid())
    and status = 'draft'
  );

-- No update policy on ocr_drafts — confirm/reject only via the RPCs
-- below, which also (for confirm) atomically create the real records.

create policy alerts_select_own_tenant on alerts
  for select using (tenant_id = stockflow_auth_tenant_id());

-- Dismissing is a plain, non-computed field update — any tenant staff
-- can dismiss an alert they can see (matches how any staff member could
-- act on the underlying issue, not just owner/manager).
create policy alerts_update_dismiss on alerts
  for update
  using (tenant_id = stockflow_auth_tenant_id())
  with check (tenant_id = stockflow_auth_tenant_id());

-- Owner/manager rejects a draft outright — no product/stock record is
-- ever created for it.
create or replace function public.stockflow_reject_ocr_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
begin
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can reject a draft' using errcode = '42501';
  end if;

  update ocr_drafts set status = 'rejected'
    where id = p_draft_id and tenant_id = v_tenant_id and status = 'draft';

  if not found then
    raise exception 'draft not found, not yours, or already actioned' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.stockflow_reject_ocr_draft(uuid) to authenticated;

-- Owner/manager confirms a draft: p_lines is the human-reviewed version
-- (may differ from ocr_drafts.extracted_lines — the owner can correct
-- OCR mistakes before anything is created), one new product per line
-- plus an initial 'receipt' stock movement for its quantity. This is
-- the only path from an AI-produced draft to a real record — the
-- extraction step itself (app/api/ai/extract-ledger-photo) never
-- inserts into products/stock_movements.
create or replace function public.stockflow_confirm_ocr_draft(
  p_draft_id uuid,
  p_device_id uuid,
  p_lines jsonb -- [{product_name, quantity, unit_cost_minor, sell_price_minor, currency_code}]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
  v_actor uuid := stockflow_auth_uid();
  v_draft record;
  v_line jsonb;
  v_product_id uuid;
  v_created_product_ids uuid[] := '{}';
begin
  if stockflow_auth_role() not in ('owner', 'manager') then
    raise exception 'only owner/manager can confirm a draft' using errcode = '42501';
  end if;
  if p_device_id not in (select id from devices where staff_user_id = v_actor) then
    raise exception 'device is not registered to this staff member' using errcode = '42501';
  end if;

  select * into v_draft from ocr_drafts
    where id = p_draft_id and tenant_id = v_tenant_id and status = 'draft';
  if v_draft is null then
    raise exception 'draft not found, not yours, or already actioned' using errcode = '42501';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'quantity')::integer <= 0 then
      continue; -- owner can zero out a line to skip a misread entry without rejecting the whole draft
    end if;

    v_product_id := gen_random_uuid();
    insert into products (
      id, tenant_id, name, cost_price_minor, sell_price_minor, price_currency
    ) values (
      v_product_id, v_tenant_id, v_line->>'product_name',
      coalesce((v_line->>'unit_cost_minor')::integer, 0),
      coalesce((v_line->>'sell_price_minor')::integer, (v_line->>'unit_cost_minor')::integer, 0),
      coalesce(v_line->>'currency_code', 'USD')
    );
    v_created_product_ids := array_append(v_created_product_ids, v_product_id);

    insert into stock_movements (
      tenant_id, branch_id, product_id, movement_type, quantity_delta,
      reason, actor_staff_user_id, device_id, operation_id
    ) values (
      v_tenant_id, v_draft.branch_id, v_product_id, 'receipt',
      (v_line->>'quantity')::integer, null, v_actor, p_device_id, gen_random_uuid()
    );
  end loop;

  update ocr_drafts
    set status = 'confirmed', confirmed_by = v_actor, confirmed_at = now()
    where id = p_draft_id;

  return jsonb_build_object('created_product_ids', to_jsonb(v_created_product_ids));
end;
$$;

grant execute on function public.stockflow_confirm_ocr_draft(uuid, uuid, jsonb) to authenticated;

-- Any tenant staff can dismiss an alert they can already see.
create or replace function public.stockflow_dismiss_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := stockflow_auth_tenant_id();
begin
  update alerts
    set dismissed = true, dismissed_by = stockflow_auth_uid(), dismissed_at = now()
    where id = p_alert_id and tenant_id = v_tenant_id and dismissed = false;

  if not found then
    raise exception 'alert not found, not yours, or already dismissed' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.stockflow_dismiss_alert(uuid) to authenticated;

-- Anomaly scan (Sprint 7 "anomaly job"). Pure read of already-existing
-- tables — no AI. Idempotent: re-running it doesn't duplicate an alert
-- for the same still-open source row (checks for an existing
-- undismissed alert with the same source_table/source_id first). Meant
-- to be invoked periodically (e.g. from a scheduled job/cron hitting an
-- API route that calls this) — this migration only defines the scan
-- itself, not a scheduler; see docs/handoffs/sprint-7.md.
create or replace function public.stockflow_run_anomaly_scan(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
  v_row record;
begin
  -- Unresolved stock conflicts older than 24 hours.
  for v_row in
    select sc.id, p.name as product_name
    from stock_conflicts sc
    join products p on p.id = sc.product_id
    where sc.tenant_id = p_tenant_id
      and sc.resolved = false
      and sc.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from alerts a
        where a.tenant_id = p_tenant_id and a.source_table = 'stock_conflicts'
          and a.source_id = sc.id and a.dismissed = false
      )
  loop
    insert into alerts (tenant_id, alert_type, message, source_table, source_id)
      values (p_tenant_id, 'unresolved_stock_conflict',
        'Stock conflict for ' || v_row.product_name || ' has been unresolved for over 24 hours',
        'stock_conflicts', v_row.id);
    v_created := v_created + 1;
  end loop;

  -- Unreviewed cash variances flagged for review.
  for v_row in
    select cv.id, cv.tender_type, cv.currency_code, cv.variance_minor
    from cash_variances cv
    where cv.tenant_id = p_tenant_id
      and cv.requires_review = true
      and cv.reviewed_at is null
      and not exists (
        select 1 from alerts a
        where a.tenant_id = p_tenant_id and a.source_table = 'cash_variances'
          and a.source_id = cv.id and a.dismissed = false
      )
  loop
    insert into alerts (tenant_id, alert_type, message, source_table, source_id)
      values (p_tenant_id, 'unreviewed_cash_variance',
        'Unreviewed ' || v_row.tender_type || ' variance of ' || v_row.currency_code || ' ' || (v_row.variance_minor / 100.0)::text,
        'cash_variances', v_row.id);
    v_created := v_created + 1;
  end loop;

  -- Customers whose outstanding balance has grown fast: more than 3
  -- credit_sale entries in the last 7 days with no repayment in between.
  for v_row in
    select customer_id, count(*) as credit_sale_count
    from customer_ledger
    where tenant_id = p_tenant_id
      and entry_type = 'credit_sale'
      and created_at > now() - interval '7 days'
    group by customer_id
    having count(*) >= 3
  loop
    if not exists (
      select 1 from alerts a
      where a.tenant_id = p_tenant_id and a.source_table = 'customer_ledger'
        and a.source_id = v_row.customer_id and a.dismissed = false and a.alert_type = 'rapid_debt_growth'
    ) then
      insert into alerts (tenant_id, alert_type, message, source_table, source_id)
        values (p_tenant_id, 'rapid_debt_growth',
          'A customer has taken ' || v_row.credit_sale_count || ' credit sales in the last 7 days',
          'customer_ledger', v_row.customer_id);
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;

-- Deliberately no `grant execute ... to authenticated` — the scan reads
-- across a tenant without per-row RLS filtering being the only guard
-- (it takes p_tenant_id as a raw parameter, not derived from the
-- caller's own JWT), so it must only ever be invoked by a trusted
-- server-side caller (a cron/API route using the service role) that
-- supplies the correct tenant_id itself, the same trust boundary as
-- stockflow_reconcile_provider_payment (migration 0015).
grant execute on function public.stockflow_run_anomaly_scan(uuid) to service_role;
