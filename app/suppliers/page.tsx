import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { NewSupplierForm } from "@/components/features/suppliers/new-supplier-form";

export default async function SuppliersPage() {
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

  const { data: tenant } = await supabase
    .from("tenants")
    .select("reporting_currency")
    .eq("id", staffUser.tenant_id)
    .maybeSingle();
  const reportingCurrency = tenant?.reporting_currency ?? "USD";

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, phone")
    .eq("tenant_id", staffUser.tenant_id)
    .order("name");

  const { data: ledger } = await supabase
    .from("supplier_ledger")
    .select("supplier_id, reporting_amount_minor")
    .eq("tenant_id", staffUser.tenant_id);

  const balanceBySupplier = new Map<string, number>();
  for (const entry of ledger ?? []) {
    balanceBySupplier.set(
      entry.supplier_id,
      (balanceBySupplier.get(entry.supplier_id) ?? 0) + entry.reporting_amount_minor,
    );
  }

  const canManage = staffUser.role === "owner" || staffUser.role === "manager";

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Suppliers</h1>
      </header>

      {canManage && <NewSupplierForm tenantId={staffUser.tenant_id} />}

      <div className="flex flex-col gap-3">
        {suppliers?.map((s, i) => {
          const balance = balanceBySupplier.get(s.id) ?? 0;
          return (
            <Link key={s.id} href={`/suppliers/${s.id}`}>
              <Card className="animate-rise-in flex items-center justify-between" style={{ animationDelay: `${i * 30}ms` }}>
                <div>
                  <p className="font-display text-lg font-semibold text-foreground">{s.name}</p>
                  {s.phone && <p className="text-xs text-foreground-muted">{s.phone}</p>}
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
