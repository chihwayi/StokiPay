import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { formatMoney } from "@/lib/domain/money";
import { Card } from "@/components/ui/card";
import { RepaymentForm } from "@/components/features/customers/repayment-form";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) redirect("/onboarding");

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("id", id)
    .eq("tenant_id", staffUser.tenant_id)
    .maybeSingle();
  if (!customer) notFound();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("reporting_currency")
    .eq("id", staffUser.tenant_id)
    .maybeSingle();
  const reportingCurrency = tenant?.reporting_currency ?? "USD";

  const { data: ledger } = await supabase
    .from("customer_ledger")
    .select("id, entry_type, reporting_amount_minor, notes, created_at")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });

  const balance = (ledger ?? []).reduce((s, e) => s + e.reporting_amount_minor, 0);

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/customers" className="text-sm font-semibold text-teal hover:underline">
          ← Customers
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">{customer.name}</h1>
        {customer.phone && <p className="text-sm text-foreground-muted">{customer.phone}</p>}
      </header>

      <Card accent className="animate-rise-in flex flex-col items-center gap-1 py-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-foreground-muted">Balance owed</p>
        <p className="font-display text-3xl font-semibold text-foreground">{formatMoney(balance, reportingCurrency)}</p>
      </Card>

      {balance > 0 && <RepaymentForm customerId={customer.id} />}

      <div className="flex flex-col gap-2">
        {(ledger ?? []).map((entry) => (
          <Card key={entry.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium capitalize text-foreground">{entry.entry_type.replace("_", " ")}</p>
              <p className="text-xs text-foreground-muted">{new Date(entry.created_at).toLocaleString()}</p>
            </div>
            <span className="text-sm font-semibold text-foreground">
              {formatMoney(entry.reporting_amount_minor, reportingCurrency)}
            </span>
          </Card>
        ))}
      </div>
    </main>
  );
}
