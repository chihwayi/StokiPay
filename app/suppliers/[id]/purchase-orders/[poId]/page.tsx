import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { formatMoney } from "@/lib/domain/money";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReceivePurchaseOrderForm } from "@/components/features/suppliers/receive-purchase-order-form";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string; poId: string }>;
}) {
  const { id, poId } = await params;
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

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, status, created_at")
    .eq("id", poId)
    .eq("tenant_id", staffUser.tenant_id)
    .maybeSingle();
  if (!po) notFound();

  const { data: lines } = await supabase
    .from("purchase_order_lines")
    .select("id, product_id, quantity_ordered, unit_cost_minor, currency_code, products(name)")
    .eq("purchase_order_id", poId);

  const canManage = staffUser.role === "owner" || staffUser.role === "manager";

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href={`/suppliers/${id}`} className="text-sm font-semibold text-teal hover:underline">
          ← Supplier
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Purchase order</h1>
          <StatusBadge tone={po.status === "received" ? "positive" : "warning"}>{po.status}</StatusBadge>
        </div>
        <p className="text-xs text-foreground-muted">{new Date(po.created_at).toLocaleString()}</p>
      </header>

      <Card className="animate-rise-in flex flex-col gap-2">
        {(lines ?? []).map((l) => (
          <div key={l.id} className="flex items-center justify-between">
            <span className="text-sm text-foreground">
              {(l.products as unknown as { name: string } | null)?.name ?? "Item"}
            </span>
            <span className="text-xs text-foreground-muted">
              {l.quantity_ordered} × {formatMoney(l.unit_cost_minor, l.currency_code)}
            </span>
          </div>
        ))}
      </Card>

      {po.status === "submitted" && canManage && (
        <ReceivePurchaseOrderForm
          purchaseOrderId={po.id}
          lines={(lines ?? []).map((l) => ({
            productId: l.product_id,
            productName: (l.products as unknown as { name: string } | null)?.name ?? "Item",
            quantityOrdered: l.quantity_ordered,
          }))}
          currencyCode={lines?.[0]?.currency_code ?? "USD"}
        />
      )}
    </main>
  );
}
