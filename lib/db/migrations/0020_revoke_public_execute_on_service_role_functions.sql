-- Bug found while writing Sprint 7's adversarial tests
-- (tests/integration/ai-copilot-ocr.test.ts): this Supabase instance's
-- `ALTER DEFAULT PRIVILEGES` setup grants EXECUTE on every new
-- public-schema function to anon/authenticated/service_role
-- automatically (confirmed via pg_proc.proacl). Migrations 0015 and
-- 0019 each added `grant execute ... to service_role` without an
-- explicit revoke first, so despite the comments describing these as
-- service-role-only, any signed-in staff member could actually call
-- them directly (stockflow_run_anomaly_scan takes a raw p_tenant_id
-- with no caller-derived scoping, and
-- stockflow_reconcile_provider_payment is meant to run only from the
-- trusted webhook route) — a real cross-tenant/authorization gap, not
-- just a redundant grant.
revoke execute on function public.stockflow_run_anomaly_scan(uuid) from public, anon, authenticated;
revoke execute on function public.stockflow_reconcile_provider_payment(uuid, text) from public, anon, authenticated;
