import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaySupplierForm } from "@/components/features/suppliers/pay-supplier-form";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, phone")
    .eq("id", id)
    .eq("tenant_id", staffUser.tenant_id)
    .maybeSingle();
  if (!supplier) notFound();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("reporting_currency")
    .eq("id", staffUser.tenant_id)
    .maybeSingle();
  const reportingCurrency = tenant?.reporting_currency ?? "USD";

  const { data: ledger } = await supabase
    .from("supplier_ledger")
    .select("id, entry_type, reporting_amount_minor, created_at")
    .eq("supplier_id", id)
    .order("created_at", { ascending: false });

  const { data: purchaseOrders } = await supabase
    .from("purchase_orders")
    .select("id, status, created_at")
    .eq("supplier_id", id)
    .order("created_at", { ascending: false });

  const balance = (ledger ?? []).reduce((s, e) => s + e.reporting_amount_minor, 0);
  const canManage = staffUser.role === "owner" || staffUser.role === "manager";

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/suppliers" className="text-sm font-semibold text-teal hover:underline">
          ← Suppliers
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">{supplier.name}</h1>
        {supplier.phone && <p className="text-sm text-foreground-muted">{supplier.phone}</p>}
      </header>

      <Card accent className="animate-rise-in flex flex-col items-center gap-1 py-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-foreground-muted">We owe</p>
        <p className="font-display text-3xl font-semibold text-foreground">{formatMoney(balance, reportingCurrency)}</p>
      </Card>

      {canManage && balance > 0 && <PaySupplierForm supplierId={supplier.id} />}

      {canManage && (
        <Link href={`/suppliers/${supplier.id}/purchase-orders/new`}>
          <Button variant="secondary" className="w-full">
            + New purchase order
          </Button>
        </Link>
      )}

      {(purchaseOrders?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">Purchase orders</p>
          {purchaseOrders?.map((po) => (
            <Link key={po.id} href={`/suppliers/${supplier.id}/purchase-orders/${po.id}`}>
              <Card className="flex items-center justify-between py-3">
                <p className="text-xs text-foreground-muted">{new Date(po.created_at).toLocaleString()}</p>
                <StatusBadge tone={po.status === "received" ? "positive" : "warning"}>{po.status}</StatusBadge>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(ledger ?? []).map((entry) => (
          <Card key={entry.id} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium capitalize text-foreground">{entry.entry_type}</p>
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
