import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/auth/supabase-server";
import { buildReport } from "@/lib/reports/build-report";
import { formatMoney } from "@/lib/domain/money";

// Same buildReport() call as the Excel export and the on-screen page —
// see that route's comment. Totals match by construction, not by
// separately re-implementing the same arithmetic three times.
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

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4
  let y = 800;

  const line = (text: string, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text, { x: 50, y, size: opts.size ?? 11, font: opts.f ?? font, color: opts.color ?? rgb(0, 0, 0) });
    y -= (opts.size ?? 11) + 8;
  };

  line("StockFlow ZW report", { size: 18, f: bold });
  line(`${from} to ${to}`, { size: 10, color: rgb(0.4, 0.4, 0.4) });
  line("Configuration/export only — not a verified ZIMRA/fiscal-device compliance integration", {
    size: 9,
    color: rgb(0.6, 0.2, 0.1),
  });
  y -= 10;

  line("Profit", { size: 14, f: bold });
  line(`Revenue: ${formatMoney(report.profit.revenueMinor, report.reportingCurrency)}`);
  line(`Cost: ${formatMoney(report.profit.costMinor, report.reportingCurrency)}`);
  line(`Profit: ${formatMoney(report.profit.profitMinor, report.reportingCurrency)}`);
  y -= 10;

  line("Cash-up", { size: 14, f: bold });
  line(`Expected: ${formatMoney(report.cashUp.expectedTotalMinor, report.reportingCurrency)}`);
  line(`Counted: ${formatMoney(report.cashUp.countedTotalMinor, report.reportingCurrency)}`);
  line(`Variance: ${formatMoney(report.cashUp.varianceTotalMinor, report.reportingCurrency)}`);
  line(`Unreviewed variances: ${report.cashUp.unreviewedCount}`);
  y -= 10;

  line("Outstanding debt", { size: 14, f: bold });
  line(`Total: ${formatMoney(report.debt.totalOutstandingMinor, report.reportingCurrency)}`);
  for (const r of report.debt.rows) {
    if (y < 60) break; // single-page report for this sprint's scope
    line(`  ${r.customerName}: ${formatMoney(r.balanceMinor, report.reportingCurrency)}`, { size: 10 });
  }
  y -= 10;

  line("Stock variance", { size: 14, f: bold });
  line(`Total absolute variance: ${report.stockVariance.totalAbsoluteVariance} units`);
  for (const r of report.stockVariance.rows) {
    if (y < 60) break;
    line(`  ${r.productName}: ${r.netVariance > 0 ? "+" : ""}${r.netVariance}`, { size: 10 });
  }

  const bytes = await doc.save();

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="stockflow-report-${from}-to-${to}.pdf"`,
    },
  });
}
