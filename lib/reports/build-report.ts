import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateProfitReport,
  computeCashUpSummary,
  computeDebtSummary,
  computeStockVarianceSummary,
} from "@/lib/domain/reports";

// Single source of truth for report data: both app/reports/page.tsx (the
// on-screen view) and the PDF/Excel export routes call this exact
// function with the exact same filters, so on-screen and exported totals
// match by construction rather than by two independently-written queries
// happening to agree (sprints.md's "on-screen, PDF and Excel totals
// match" acceptance criterion). Takes the caller's own request-scoped
// Supabase client (cookie-based session) so exports are bound by the
// same RLS as the screen — never a service-role client.

export type ReportFilters = {
  tenantId: string;
  branchId?: string;
  dateFrom: string; // ISO date, inclusive
  dateTo: string; // ISO date, exclusive (i.e. pass the day after the last day you want)
};

export type ReportData = {
  filters: ReportFilters;
  reportingCurrency: string;
  profit: ReturnType<typeof aggregateProfitReport>;
  cashUp: ReturnType<typeof computeCashUpSummary>;
  debt: {
    totalOutstandingMinor: number;
    rows: { customerId: string; customerName: string; balanceMinor: number }[];
  };
  stockVariance: {
    totalAbsoluteVariance: number;
    rows: { productId: string; productName: string; netVariance: number }[];
  };
};

export async function buildReport(
  supabase: SupabaseClient,
  filters: ReportFilters,
): Promise<ReportData> {
  const { tenantId, branchId, dateFrom, dateTo } = filters;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("reporting_currency")
    .eq("id", tenantId)
    .maybeSingle();
  const reportingCurrency = tenant?.reporting_currency ?? "USD";

  // --- Profit: sales in range, then their line items ---
  let salesQuery = supabase
    .from("sales")
    .select("id, exchange_rate_snapshot")
    .eq("tenant_id", tenantId)
    .gte("created_at", dateFrom)
    .lt("created_at", dateTo);
  if (branchId) salesQuery = salesQuery.eq("branch_id", branchId);
  const { data: sales } = await salesQuery;

  const rateBySale = new Map((sales ?? []).map((s) => [s.id, Number(s.exchange_rate_snapshot)]));
  const saleIds = (sales ?? []).map((s) => s.id);

  const { data: saleItems } = saleIds.length
    ? await supabase
        .from("sale_items")
        .select("sale_id, quantity, unit_price_minor, unit_cost_price_minor")
        .in("sale_id", saleIds)
    : { data: [] };

  const profit = aggregateProfitReport(
    (saleItems ?? []).map((i) => ({
      quantity: i.quantity,
      unitPriceMinor: i.unit_price_minor,
      unitCostPriceMinor: i.unit_cost_price_minor,
      saleExchangeRateSnapshot: rateBySale.get(i.sale_id) ?? 1,
    })),
  );

  // --- Cash-up: sessions closed in range, then their variances ---
  let sessionsQuery = supabase
    .from("cash_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")
    .gte("closed_at", dateFrom)
    .lt("closed_at", dateTo);
  if (branchId) sessionsQuery = sessionsQuery.eq("branch_id", branchId);
  const { data: sessions } = await sessionsQuery;
  const sessionIds = (sessions ?? []).map((s) => s.id);

  const { data: variances } = sessionIds.length
    ? await supabase
        .from("cash_variances")
        .select("tender_type, currency_code, expected_amount_minor, counted_amount_minor, variance_minor, requires_review, reviewed_at")
        .in("cash_session_id", sessionIds)
    : { data: [] };

  const cashUp = computeCashUpSummary(
    (variances ?? []).map((v) => ({
      tenderType: v.tender_type,
      currencyCode: v.currency_code,
      expectedAmountMinor: v.expected_amount_minor,
      countedAmountMinor: v.counted_amount_minor,
      varianceMinor: v.variance_minor,
      requiresReview: v.requires_review,
      reviewedAt: v.reviewed_at,
    })),
  );

  // --- Debt: current outstanding balance per customer, tenant-wide
  // (customer_ledger has no branch_id — a customer's debt isn't tied to
  // one branch) ---
  const { data: ledgerEntries } = await supabase
    .from("customer_ledger")
    .select("customer_id, reporting_amount_minor")
    .eq("tenant_id", tenantId);
  const { rows: debtRowsRaw, totalOutstandingMinor } = computeDebtSummary(
    (ledgerEntries ?? []).map((e) => ({ customerId: e.customer_id, reportingAmountMinor: e.reporting_amount_minor })),
  );
  const { data: customers } = debtRowsRaw.length
    ? await supabase.from("customers").select("id, name").in("id", debtRowsRaw.map((r) => r.customerId))
    : { data: [] };
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const debt = {
    totalOutstandingMinor,
    rows: debtRowsRaw
      .filter((r) => r.balanceMinor > 0)
      .map((r) => ({ ...r, customerName: customerNameById.get(r.customerId) ?? "Unknown" })),
  };

  // --- Stock variance: count_variance movements in range ---
  let movementsQuery = supabase
    .from("stock_movements")
    .select("product_id, quantity_delta")
    .eq("tenant_id", tenantId)
    .eq("movement_type", "count_variance")
    .gte("created_at", dateFrom)
    .lt("created_at", dateTo);
  if (branchId) movementsQuery = movementsQuery.eq("branch_id", branchId);
  const { data: movements } = await movementsQuery;
  const { rows: varianceRowsRaw, totalAbsoluteVariance } = computeStockVarianceSummary(
    (movements ?? []).map((m) => ({ productId: m.product_id, quantityDelta: m.quantity_delta })),
  );
  const { data: products } = varianceRowsRaw.length
    ? await supabase.from("products").select("id, name").in("id", varianceRowsRaw.map((r) => r.productId))
    : { data: [] };
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const stockVariance = {
    totalAbsoluteVariance,
    rows: varianceRowsRaw.map((r) => ({ ...r, productName: productNameById.get(r.productId) ?? "Unknown" })),
  };

  return { filters, reportingCurrency, profit, cashUp, debt, stockVariance };
}
