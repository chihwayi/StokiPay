// Pure report calculations (docs/architecture.md's lib/domain/ contract
// — no HTTP/React/provider calls). Every function here reads only
// already-stored snapshots (ADR 0004) — a sale's own
// exchange_rate_snapshot and a sale_item's own unit_cost_price_minor
// (frozen at sale time, Sprint 3) — and never looks up today's
// exchange_rates or a product's current cost_price_minor. This is what
// makes "a changed product cost does not alter historic profit" and
// "reports use stored rate context, not today's rate" true by
// construction rather than by convention.

export type SaleItemProfitInput = {
  quantity: number;
  unitPriceMinor: number;
  unitCostPriceMinor: number;
  saleExchangeRateSnapshot: number; // the parent sale's own stored rate to reporting currency
};

export type ProfitLine = {
  revenueMinor: number;
  costMinor: number;
  profitMinor: number;
};

// Mirrors the rounding convention the RPCs already use
// (round(amount * rate)) so a report total is reconstructable to the
// cent from the same rows PostgREST returns, not just "close enough".
export function computeSaleItemProfit(item: SaleItemProfitInput): ProfitLine {
  const revenueMinor = Math.round(item.quantity * item.unitPriceMinor * item.saleExchangeRateSnapshot);
  const costMinor = Math.round(item.quantity * item.unitCostPriceMinor * item.saleExchangeRateSnapshot);
  return { revenueMinor, costMinor, profitMinor: revenueMinor - costMinor };
}

export function aggregateProfitReport(items: SaleItemProfitInput[]): ProfitLine & { lineCount: number } {
  return items.reduce(
    (acc, item) => {
      const line = computeSaleItemProfit(item);
      return {
        revenueMinor: acc.revenueMinor + line.revenueMinor,
        costMinor: acc.costMinor + line.costMinor,
        profitMinor: acc.profitMinor + line.profitMinor,
        lineCount: acc.lineCount + 1,
      };
    },
    { revenueMinor: 0, costMinor: 0, profitMinor: 0, lineCount: 0 },
  );
}

export type CashVarianceInput = {
  tenderType: string;
  currencyCode: string;
  expectedAmountMinor: number;
  countedAmountMinor: number;
  varianceMinor: number;
  requiresReview: boolean;
  reviewedAt: string | null;
};

export type CashUpSummary = {
  expectedTotalMinor: number;
  countedTotalMinor: number;
  varianceTotalMinor: number;
  unreviewedCount: number;
};

// Reconciles a set of cash_variances rows (one or more sessions) to a
// single summary. Never recomputes expected/variance itself — those are
// the server's own stockflow_close_cash_session output (Sprint 3), this
// only aggregates what's already been reconciled.
export function computeCashUpSummary(variances: CashVarianceInput[]): CashUpSummary {
  return variances.reduce(
    (acc, v) => ({
      expectedTotalMinor: acc.expectedTotalMinor + v.expectedAmountMinor,
      countedTotalMinor: acc.countedTotalMinor + v.countedAmountMinor,
      varianceTotalMinor: acc.varianceTotalMinor + v.varianceMinor,
      unreviewedCount: acc.unreviewedCount + (v.requiresReview && !v.reviewedAt ? 1 : 0),
    }),
    { expectedTotalMinor: 0, countedTotalMinor: 0, varianceTotalMinor: 0, unreviewedCount: 0 },
  );
}

export type LedgerEntryInput = {
  customerId: string;
  reportingAmountMinor: number;
};

export type DebtSummaryRow = { customerId: string; balanceMinor: number };

// Outstanding debt per customer — balance is always summed from ledger
// entries (never a stored column), same discipline as
// lib/db/migrations/0010... establishes at the schema level.
export function computeDebtSummary(entries: LedgerEntryInput[]): {
  rows: DebtSummaryRow[];
  totalOutstandingMinor: number;
} {
  const byCustomer = new Map<string, number>();
  for (const e of entries) {
    byCustomer.set(e.customerId, (byCustomer.get(e.customerId) ?? 0) + e.reportingAmountMinor);
  }
  const rows = Array.from(byCustomer.entries())
    .map(([customerId, balanceMinor]) => ({ customerId, balanceMinor }))
    .filter((r) => r.balanceMinor !== 0);
  const totalOutstandingMinor = rows.reduce((s, r) => s + Math.max(r.balanceMinor, 0), 0);
  return { rows, totalOutstandingMinor };
}

export type StockVarianceMovementInput = {
  productId: string;
  quantityDelta: number;
};

export type StockVarianceRow = { productId: string; netVariance: number };

// Net stock variance per product from approved count_variance movements
// (Sprint 2) over the report period — reconciles to stock_movements the
// same way stock_levels does (sum of movements), just filtered to one
// movement_type instead of all of them.
export function computeStockVarianceSummary(movements: StockVarianceMovementInput[]): {
  rows: StockVarianceRow[];
  totalAbsoluteVariance: number;
} {
  const byProduct = new Map<string, number>();
  for (const m of movements) {
    byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + m.quantityDelta);
  }
  const rows = Array.from(byProduct.entries())
    .map(([productId, netVariance]) => ({ productId, netVariance }))
    .filter((r) => r.netVariance !== 0);
  const totalAbsoluteVariance = rows.reduce((s, r) => s + Math.abs(r.netVariance), 0);
  return { rows, totalAbsoluteVariance };
}

export type SaleItemProductInput = SaleItemProfitInput & { productId: string; productName: string };

export type ProductSalesRow = { productId: string; productName: string; revenueMinor: number; quantitySold: number };

// Per-product revenue/quantity ranking, same frozen-snapshot discipline
// as computeSaleItemProfit — used for the Sprint 7 copilot's "best/worst
// seller" tool.
export function computeBestWorstSellers(items: SaleItemProductInput[]): {
  bestSellers: ProductSalesRow[];
  worstSellers: ProductSalesRow[];
} {
  const byProduct = new Map<string, ProductSalesRow>();
  for (const item of items) {
    const { revenueMinor } = computeSaleItemProfit(item);
    const existing = byProduct.get(item.productId);
    if (existing) {
      existing.revenueMinor += revenueMinor;
      existing.quantitySold += item.quantity;
    } else {
      byProduct.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        revenueMinor,
        quantitySold: item.quantity,
      });
    }
  }
  const rows = Array.from(byProduct.values()).sort((a, b) => b.revenueMinor - a.revenueMinor);
  return {
    bestSellers: rows.slice(0, 5),
    worstSellers: rows.slice(-5).reverse(),
  };
}
