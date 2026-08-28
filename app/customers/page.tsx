import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { NewCustomerForm } from "@/components/features/customers/new-customer-form";

export default async function CustomersPage() {
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

  const { data: tenant } = await supabase
    .from("tenants")
    .select("reporting_currency")
    .eq("id", staffUser.tenant_id)
    .maybeSingle();
  const reportingCurrency = tenant?.reporting_currency ?? "USD";

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone")
    .eq("tenant_id", staffUser.tenant_id)
    .order("name");

  const { data: ledger } = await supabase
    .from("customer_ledger")
    .select("customer_id, reporting_amount_minor")
    .eq("tenant_id", staffUser.tenant_id);

  const balanceByCustomer = new Map<string, number>();
  for (const entry of ledger ?? []) {
    balanceByCustomer.set(
      entry.customer_id,
      (balanceByCustomer.get(entry.customer_id) ?? 0) + entry.reporting_amount_minor,
    );
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Customers</h1>
      </header>

      <NewCustomerForm tenantId={staffUser.tenant_id} />

      <div className="flex flex-col gap-3">
        {customers?.map((c, i) => {
          const balance = balanceByCustomer.get(c.id) ?? 0;
          return (
            <Link key={c.id} href={`/customers/${c.id}`}>
              <Card className="animate-rise-in flex items-center justify-between" style={{ animationDelay: `${i * 30}ms` }}>
                <div>
                  <p className="font-display text-lg font-semibold text-foreground">{c.name}</p>
                  {c.phone && <p className="text-xs text-foreground-muted">{c.phone}</p>}
                </div>
                {balance > 0 ? (
                  <StatusBadge tone="warning">{formatMoney(balance, reportingCurrency)} owed</StatusBadge>
                ) : (
                  <Button variant="ghost" className="min-h-10 px-4 text-sm">
                    View
                  </Button>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
