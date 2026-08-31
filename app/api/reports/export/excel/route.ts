import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/auth/supabase-server";
import { buildReport } from "@/lib/reports/build-report";

// Reads the exact same buildReport() output the on-screen page renders
// (sprints.md's "on-screen, PDF and Excel totals match" acceptance
// criterion) — this route never recomputes its own totals. Uses the
// request's own cookie-scoped Supabase client, so an export can only
// ever contain what the requesting staff member's RLS already permits.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser || (staffUser.role !== "owner" && staffUser.role !== "manager")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  const branchId = searchParams.get("branch") || undefined;

  const dateToExclusive = new Date(to + "T00:00:00Z");
  dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);

  const report = await buildReport(supabase, {
    tenantId: staffUser.tenant_id,
    branchId,
    dateFrom: new Date(from + "T00:00:00Z").toISOString(),
    dateTo: dateToExclusive.toISOString(),
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "StockFlow ZW";

  const summary = workbook.addWorksheet("Summary");
  summary.addRow(["StockFlow ZW report", `${from} to ${to}`]);
  summary.addRow(["Configuration/export only — not a verified ZIMRA/fiscal-device compliance integration"]);
  summary.addRow([]);
  summary.addRow(["Metric", `Amount (${report.reportingCurrency})`]);
  summary.addRow(["Revenue", report.profit.revenueMinor / 100]);
  summary.addRow(["Cost", report.profit.costMinor / 100]);
  summary.addRow(["Profit", report.profit.profitMinor / 100]);
  summary.addRow(["Cash-up expected", report.cashUp.expectedTotalMinor / 100]);
  summary.addRow(["Cash-up counted", report.cashUp.countedTotalMinor / 100]);
  summary.addRow(["Cash-up variance", report.cashUp.varianceTotalMinor / 100]);
  summary.addRow(["Unreviewed variances", report.cashUp.unreviewedCount]);
  summary.addRow(["Total outstanding debt", report.debt.totalOutstandingMinor / 100]);
  summary.addRow(["Total absolute stock variance (units)", report.stockVariance.totalAbsoluteVariance]);

  const debtSheet = workbook.addWorksheet("Debt");
  debtSheet.addRow(["Customer", `Balance (${report.reportingCurrency})`]);
  for (const r of report.debt.rows) debtSheet.addRow([r.customerName, r.balanceMinor / 100]);

  const stockSheet = workbook.addWorksheet("Stock Variance");
  stockSheet.addRow(["Product", "Net variance (units)"]);
  for (const r of report.stockVariance.rows) stockSheet.addRow([r.productName, r.netVariance]);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stockflow-report-${from}-to-${to}.xlsx"`,
    },
  });
}
