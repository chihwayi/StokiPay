import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReceiveStockForm } from "@/components/features/stock/receive-stock-form";
import { AdjustStockForm } from "@/components/features/stock/adjust-stock-form";

export default async function ProductsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("role, tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staffUser) redirect("/onboarding");

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("is_primary", true)
    .maybeSingle();

  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit, barcode, low_stock_threshold")
    .eq("tenant_id", staffUser.tenant_id)
    .order("name");

  const { data: levels } = await supabase
    .from("stock_levels")
    .select("product_id, quantity")
    .eq("tenant_id", staffUser.tenant_id);

  const levelByProduct = new Map((levels ?? []).map((l) => [l.product_id, l.quantity]));
  const canManage = staffUser.role === "owner" || staffUser.role === "manager";

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
            ← Dashboard
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            Products
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/counts">
            <Button variant="ghost" className="min-h-11 px-4 text-sm">
              Stock counts
            </Button>
          </Link>
          {canManage && (
            <Link href="/products/new">
              <Button className="min-h-11 px-4 text-sm">+ New</Button>
            </Link>
          )}
        </div>
      </header>

      {!products?.length && (
        <Card accent className="animate-rise-in flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-display text-xl font-semibold text-foreground">No products yet</p>
          <p className="max-w-xs text-sm text-foreground-muted">
            {canManage
              ? "Add your first product to start tracking stock."
              : "Ask an owner or manager to add products."}
          </p>
          {canManage && (
            <Link href="/products/new">
              <Button className="mt-1 min-h-11 px-5 text-sm">Add a product</Button>
            </Link>
          )}
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {products?.map((p, i) => {
          const quantity = levelByProduct.get(p.id) ?? 0;
          const isLow = quantity <= p.low_stock_threshold;
          return (
            <Card key={p.id} className="animate-rise-in flex flex-col gap-3">
              <div style={{ animationDelay: `${i * 40}ms` }} className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold text-foreground">{p.name}</p>
                  <p className="text-xs text-foreground-muted">
                    {quantity} {p.unit} on hand
                    {p.barcode ? ` · ${p.barcode}` : ""}
                  </p>
                </div>
                {isLow && <StatusBadge tone="warning">Low stock</StatusBadge>}
              </div>
              {branch && (
                <div className="flex flex-wrap items-center gap-2">
                  <ReceiveStockForm productId={p.id} tenantId={staffUser.tenant_id} branchId={branch.id} />
                  <AdjustStockForm productId={p.id} tenantId={staffUser.tenant_id} branchId={branch.id} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
