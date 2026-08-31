import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { buildReport } from "@/lib/reports/build-report";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReportFiltersForm } from "@/components/features/reports/report-filters-form";

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) redirect("/onboarding");
  if (staffUser.role !== "owner" && staffUser.role !== "manager") redirect("/dashboard");

  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", staffUser.tenant_id)
    .order("name");

  const defaults = defaultDateRange();
  const dateFrom = params.from ?? defaults.from;
  const dateToInclusive = params.to ?? defaults.to;
  // dateTo in buildReport is exclusive — add one day so the picked end date is included.
  const dateToExclusive = new Date(dateToInclusive + "T00:00:00Z");
  dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);

  const report = await buildReport(supabase, {
    tenantId: staffUser.tenant_id,
    branchId: params.branch || undefined,
    dateFrom: new Date(dateFrom + "T00:00:00Z").toISOString(),
    dateTo: dateToExclusive.toISOString(),
  });

  const exportQuery = new URLSearchParams({
    from: dateFrom,
    to: dateToInclusive,
    ...(params.branch ? { branch: params.branch } : {}),
  }).toString();

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Reports</h1>
      </header>

      <ReportFiltersForm branches={branches ?? []} dateFrom={dateFrom} dateTo={dateToInclusive} branchId={params.branch ?? ""} />

      <div className="flex gap-2">
        <a href={`/api/reports/export/pdf?${exportQuery}`}>
          <Button variant="ghost" className="min-h-11 px-4 text-sm">
            Export PDF
          </Button>
        </a>
        <a href={`/api/reports/export/excel?${exportQuery}`}>
          <Button variant="ghost" className="min-h-11 px-4 text-sm">
            Export Excel
          </Button>
        </a>
      </div>

      <Card accent className="animate-rise-in flex flex-col gap-3">
        <p className="font-display text-lg font-semibold text-foreground">Profit</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">Revenue</span>
          <span className="text-sm font-semibold text-foreground">{formatMoney(report.profit.revenueMinor, report.reportingCurrency)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">Cost</span>
          <span className="text-sm font-semibold text-foreground">{formatMoney(report.profit.costMinor, report.reportingCurrency)}</span>
        </div>
        <div className="flex items-center justify-between border-t-2 border-border pt-3">
          <span className="font-display text-lg font-semibold text-foreground">Profit</span>
          <span className="font-display text-lg font-semibold text-foreground">{formatMoney(report.profit.profitMinor, report.reportingCurrency)}</span>
        </div>
      </Card>

      <Card className="animate-rise-in flex flex-col gap-3">
        <p className="font-display text-lg font-semibold text-foreground">Cash-up</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">Expected</span>
          <span className="text-sm font-semibold text-foreground">{formatMoney(report.cashUp.expectedTotalMinor, report.reportingCurrency)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">Counted</span>
          <span className="text-sm font-semibold text-foreground">{formatMoney(report.cashUp.countedTotalMinor, report.reportingCurrency)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-muted">Variance</span>
          <span className="text-sm font-semibold text-foreground">{formatMoney(report.cashUp.varianceTotalMinor, report.reportingCurrency)}</span>
        </div>
        {report.cashUp.unreviewedCount > 0 && (
          <StatusBadge tone="negative">{report.cashUp.unreviewedCount} unreviewed variance(s)</StatusBadge>
        )}
      </Card>

      <Card className="animate-rise-in flex flex-col gap-3">
        <p className="font-display text-lg font-semibold text-foreground">Outstanding debt</p>
        <p className="font-display text-2xl font-semibold text-foreground">
          {formatMoney(report.debt.totalOutstandingMinor, report.reportingCurrency)}
        </p>
        {report.debt.rows.map((r) => (
          <div key={r.customerId} className="flex items-center justify-between text-sm">
            <span className="text-foreground-muted">{r.customerName}</span>
            <span className="font-medium text-foreground">{formatMoney(r.balanceMinor, report.reportingCurrency)}</span>
          </div>
        ))}
      </Card>

      <Card className="animate-rise-in flex flex-col gap-3">
        <p className="font-display text-lg font-semibold text-foreground">Stock variance</p>
        <p className="text-sm text-foreground-muted">{report.stockVariance.totalAbsoluteVariance} units net variance</p>
        {report.stockVariance.rows.map((r) => (
          <div key={r.productId} className="flex items-center justify-between text-sm">
            <span className="text-foreground-muted">{r.productName}</span>
            <span className="font-medium text-foreground">{r.netVariance > 0 ? "+" : ""}{r.netVariance}</span>
          </div>
        ))}
      </Card>

      <p className="text-center text-xs text-foreground-muted">
        Exports are configuration/export only — not a verified ZIMRA/fiscal-device compliance integration.
      </p>
    </main>
  );
}
