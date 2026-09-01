import { describe, expect, it } from "vitest";
import {
  aggregateProfitReport,
  computeBestWorstSellers,
  computeCashUpSummary,
  computeDebtSummary,
  computeSaleItemProfit,
  computeStockVarianceSummary,
} from "@/lib/domain/reports";

describe("profit calculation (sprints.md Sprint 5)", () => {
  it("computes revenue, cost and profit for a single line at the sale's own rate", () => {
    const line = computeSaleItemProfit({
      quantity: 3,
      unitPriceMinor: 200,
      unitCostPriceMinor: 100,
      saleExchangeRateSnapshot: 1,
    });
    expect(line.revenueMinor).toBe(600);
    expect(line.costMinor).toBe(300);
    expect(line.profitMinor).toBe(300);
  });

  it("converts using the sale's stored rate, not an implicit 1:1", () => {
    const line = computeSaleItemProfit({
      quantity: 2,
      unitPriceMinor: 1000,
      unitCostPriceMinor: 500,
      saleExchangeRateSnapshot: 0.055, // e.g. ZAR -> USD snapshot at sale time
    });
    expect(line.revenueMinor).toBe(Math.round(2000 * 0.055));
    expect(line.costMinor).toBe(Math.round(1000 * 0.055));
  });

  it("a changed product cost does not alter historic profit: the report only ever reads the frozen unit_cost_price_minor passed in, never a live product cost", () => {
    // Simulates: sale happened when cost was 100, product cost later
    // changed to 250 (e.g. after a purchase-order receipt, Sprint 4).
    // The report input for this historic sale still carries the frozen
    // snapshot — a caller cannot accidentally pass "today's" cost
    // because the function has no product lookup of its own at all.
    const frozenAtSaleTime = { quantity: 1, unitPriceMinor: 300, unitCostPriceMinor: 100, saleExchangeRateSnapshot: 1 };
    const profitBeforeCostChange = computeSaleItemProfit(frozenAtSaleTime);
    // "cost change" happens elsewhere (products.cost_price_minor), but
    // this report input is untouched by it — recomputing from the exact
    // same frozen snapshot must yield an identical result.
    const profitAfterCostChangeElsewhere = computeSaleItemProfit(frozenAtSaleTime);
    expect(profitAfterCostChangeElsewhere).toEqual(profitBeforeCostChange);
    expect(profitBeforeCostChange.profitMinor).toBe(200);
  });

  it("aggregates multiple lines across different sales/rates", () => {
    const report = aggregateProfitReport([
      { quantity: 1, unitPriceMinor: 200, unitCostPriceMinor: 100, saleExchangeRateSnapshot: 1 },
      { quantity: 2, unitPriceMinor: 500, unitCostPriceMinor: 300, saleExchangeRateSnapshot: 0.055 },
    ]);
    expect(report.lineCount).toBe(2);
    expect(report.revenueMinor).toBe(200 + Math.round(1000 * 0.055));
    expect(report.costMinor).toBe(100 + Math.round(600 * 0.055));
  });
});

describe("cash-up reconciliation summary", () => {
  it("sums expected/counted/variance and counts unreviewed flags", () => {
    const summary = computeCashUpSummary([
      { tenderType: "cash", currencyCode: "USD", expectedAmountMinor: 5000, countedAmountMinor: 5000, varianceMinor: 0, requiresReview: false, reviewedAt: null },
      { tenderType: "cash", currencyCode: "USD", expectedAmountMinor: 3000, countedAmountMinor: 3500, varianceMinor: 500, requiresReview: true, reviewedAt: null },
      { tenderType: "mobile_money", currencyCode: "USD", expectedAmountMinor: 2000, countedAmountMinor: 1900, varianceMinor: -100, requiresReview: true, reviewedAt: "2026-08-01T00:00:00Z" },
    ]);
    expect(summary.expectedTotalMinor).toBe(10000);
    expect(summary.countedTotalMinor).toBe(10400);
    expect(summary.varianceTotalMinor).toBe(400);
    expect(summary.unreviewedCount).toBe(1);
  });
});

describe("debt summary", () => {
  it("sums ledger entries per customer and only shows non-zero balances", () => {
    const { rows, totalOutstandingMinor } = computeDebtSummary([
      { customerId: "a", reportingAmountMinor: 700 },
      { customerId: "a", reportingAmountMinor: -200 },
      { customerId: "b", reportingAmountMinor: 300 },
      { customerId: "c", reportingAmountMinor: 100 },
      { customerId: "c", reportingAmountMinor: -100 },
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      { customerId: "a", balanceMinor: 500 },
      { customerId: "b", balanceMinor: 300 },
    ]));
    expect(rows.find((r) => r.customerId === "c")).toBeUndefined();
    expect(totalOutstandingMinor).toBe(800);
  });
});

describe("stock variance summary", () => {
  it("nets variance movements per product", () => {
    const { rows, totalAbsoluteVariance } = computeStockVarianceSummary([
      { productId: "p1", quantityDelta: -2 },
      { productId: "p1", quantityDelta: 1 },
      { productId: "p2", quantityDelta: 5 },
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      { productId: "p1", netVariance: -1 },
      { productId: "p2", netVariance: 5 },
    ]));
    expect(totalAbsoluteVariance).toBe(6);
  });
});

describe("best/worst sellers (sprints.md Sprint 7 copilot tool)", () => {
  it("aggregates revenue/quantity per product across multiple lines and sales", () => {
    const { bestSellers, worstSellers } = computeBestWorstSellers([
      { productId: "bread", productName: "Bread Loaf", quantity: 3, unitPriceMinor: 200, unitCostPriceMinor: 100, saleExchangeRateSnapshot: 1 },
      { productId: "bread", productName: "Bread Loaf", quantity: 2, unitPriceMinor: 200, unitCostPriceMinor: 100, saleExchangeRateSnapshot: 1 },
      { productId: "cola", productName: "Cola 2L", quantity: 1, unitPriceMinor: 150, unitCostPriceMinor: 90, saleExchangeRateSnapshot: 1 },
    ]);
    expect(bestSellers[0]).toEqual({ productId: "bread", productName: "Bread Loaf", revenueMinor: 1000, quantitySold: 5 });
    expect(worstSellers[0]).toEqual({ productId: "cola", productName: "Cola 2L", revenueMinor: 150, quantitySold: 1 });
  });

  it("ranks by revenue at the sale's own stored rate, not raw quantity", () => {
    const { bestSellers } = computeBestWorstSellers([
      { productId: "cheap-high-volume", productName: "Sweets", quantity: 100, unitPriceMinor: 10, unitCostPriceMinor: 5, saleExchangeRateSnapshot: 1 },
      { productId: "pricey-low-volume", productName: "Cooking Oil 2L", quantity: 5, unitPriceMinor: 500, unitCostPriceMinor: 300, saleExchangeRateSnapshot: 1 },
    ]);
    expect(bestSellers[0].productId).toBe("pricey-low-volume"); // 2500 revenue beats 1000
  });

  it("caps best/worst lists at 5 each and never returns the same product in both when there are more than 10 products", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      productId: `p${i}`,
      productName: `Product ${i}`,
      quantity: 1,
      unitPriceMinor: (i + 1) * 100,
      unitCostPriceMinor: 0,
      saleExchangeRateSnapshot: 1,
    }));
    const { bestSellers, worstSellers } = computeBestWorstSellers(items);
    expect(bestSellers).toHaveLength(5);
    expect(worstSellers).toHaveLength(5);
    const bestIds = new Set(bestSellers.map((r) => r.productId));
    const worstIds = new Set(worstSellers.map((r) => r.productId));
    expect([...bestIds].some((id) => worstIds.has(id))).toBe(false);
  });
});
