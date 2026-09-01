import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CopilotToolDefinition } from "@/lib/integrations/anthropic";
import { computeBestWorstSellers, computeDebtSummary } from "@/lib/domain/reports";
import { buildReport } from "@/lib/reports/build-report";

// Read-only, tenant-scoped copilot tools (CLAUDE.md rule 6, sprints.md
// Sprint 7). The single load-bearing safety property: every tool here
// takes `tenantId` as a parameter fixed by the *caller* (the API route,
// from the requesting staff member's own session) — it is never part of
// a tool's input_schema exposed to the model, so there is no field the
// model could set to a different tenant's id even if it tried. Combined
// with `supabase` being the request's own cookie-scoped, RLS-bound
// client (never service-role), cross-tenant access is blocked at two
// independent layers, not just by trusting the model to behave.
// tests/integration/copilot.test.ts exercises this directly.

export type ToolContext = { supabase: SupabaseClient; tenantId: string };

export const COPILOT_TOOL_DEFINITIONS: CopilotToolDefinition[] = [
  {
    name: "get_profit_summary",
    description: "Revenue, cost and profit for this business over a date range.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "ISO date, inclusive, e.g. 2026-08-01" },
        date_to: { type: "string", description: "ISO date, inclusive, e.g. 2026-08-31" },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "get_best_worst_sellers",
    description: "Best and worst selling products by revenue over a date range.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "ISO date, inclusive" },
        date_to: { type: "string", description: "ISO date, inclusive" },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "get_debt_summary",
    description: "Current outstanding customer debt, tenant-wide (not date-ranged — it's a live balance).",
    input_schema: { type: "object", properties: {} },
  },
];

function exclusiveDateTo(dateTo: string): string {
  const d = new Date(dateTo + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export async function executeCopilotTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const args = (input ?? {}) as { date_from?: string; date_to?: string };

  switch (name) {
    case "get_profit_summary": {
      if (!args.date_from || !args.date_to) return { error: "date_from and date_to are required" };
      const report = await buildReport(ctx.supabase, {
        tenantId: ctx.tenantId,
        dateFrom: new Date(args.date_from + "T00:00:00Z").toISOString(),
        dateTo: exclusiveDateTo(args.date_to),
      });
      return {
        citation: `Sales from ${args.date_from} to ${args.date_to}, ${report.reportingCurrency}`,
        revenueMinor: report.profit.revenueMinor,
        costMinor: report.profit.costMinor,
        profitMinor: report.profit.profitMinor,
        currency: report.reportingCurrency,
      };
    }
    case "get_best_worst_sellers": {
      if (!args.date_from || !args.date_to) return { error: "date_from and date_to are required" };
      const { data: sales } = await ctx.supabase
        .from("sales")
        .select("id, exchange_rate_snapshot")
        .eq("tenant_id", ctx.tenantId)
        .gte("created_at", new Date(args.date_from + "T00:00:00Z").toISOString())
        .lt("created_at", exclusiveDateTo(args.date_to));
      const rateBySale = new Map((sales ?? []).map((s) => [s.id, Number(s.exchange_rate_snapshot)]));
      const saleIds = (sales ?? []).map((s) => s.id);
      const { data: items } = saleIds.length
        ? await ctx.supabase
            .from("sale_items")
            .select("sale_id, product_id, quantity, unit_price_minor, unit_cost_price_minor, products(name)")
            .in("sale_id", saleIds)
        : { data: [] };
      const { bestSellers, worstSellers } = computeBestWorstSellers(
        (items ?? []).map((i) => ({
          productId: i.product_id,
          productName: (i.products as unknown as { name: string } | null)?.name ?? "Unknown",
          quantity: i.quantity,
          unitPriceMinor: i.unit_price_minor,
          unitCostPriceMinor: i.unit_cost_price_minor,
          saleExchangeRateSnapshot: rateBySale.get(i.sale_id) ?? 1,
        })),
      );
      return {
        citation: `Sales from ${args.date_from} to ${args.date_to}`,
        bestSellers,
        worstSellers,
      };
    }
    case "get_debt_summary": {
      const { data: ledger } = await ctx.supabase
        .from("customer_ledger")
        .select("customer_id, reporting_amount_minor")
        .eq("tenant_id", ctx.tenantId);
      const { rows, totalOutstandingMinor } = computeDebtSummary(
        (ledger ?? []).map((e) => ({ customerId: e.customer_id, reportingAmountMinor: e.reporting_amount_minor })),
      );
      const { data: customers } = rows.length
        ? await ctx.supabase.from("customers").select("id, name").in("id", rows.map((r) => r.customerId))
        : { data: [] };
      const nameById = new Map((customers ?? []).map((c) => [c.id, c.name]));
      return {
        citation: "Live customer_ledger balance as of now",
        totalOutstandingMinor,
        topDebtors: rows
          .sort((a, b) => b.balanceMinor - a.balanceMinor)
          .slice(0, 5)
          .map((r) => ({ customerName: nameById.get(r.customerId) ?? "Unknown", balanceMinor: r.balanceMinor })),
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
