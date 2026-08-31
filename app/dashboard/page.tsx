import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { SyncStatusIndicator } from "@/components/features/sync/sync-status-indicator";
import { DeviceRegistration } from "@/components/features/auth/device-registration";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Mangwanani";
  if (hour < 18) return "Masikati";
  return "Manheru";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("role, tenant_id, tenants(name, vertical)")
    .eq("id", user.id)
    .maybeSingle();

  if (!staffUser) {
    redirect("/onboarding");
  }

  const tenant = Array.isArray(staffUser.tenants) ? staffUser.tenants[0] : staffUser.tenants;

  const { data: products } = await supabase
    .from("products")
    .select("id, low_stock_threshold")
    .eq("tenant_id", staffUser.tenant_id);

  const { data: levels } = await supabase
    .from("stock_levels")
    .select("product_id, quantity")
    .eq("tenant_id", staffUser.tenant_id);

  const levelByProduct = new Map((levels ?? []).map((l) => [l.product_id, l.quantity]));
  const lowStockCount = (products ?? []).filter(
    (p) => (levelByProduct.get(p.id) ?? 0) <= p.low_stock_threshold,
  ).length;

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold uppercase tracking-widest text-teal">
            {greeting()}
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            {tenant?.name ?? "Your business"}
          </h1>
          <p className="text-sm text-foreground-muted">
            {user.phone} · <span className="capitalize">{staffUser.role}</span>
          </p>
        </div>
        <SyncStatusIndicator />
      </header>

      <div style={{ animationDelay: "80ms" }} className="animate-rise-in">
        <DeviceRegistration />
      </div>

      <Card accent className="animate-rise-in flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-2xl font-semibold text-foreground">
              {products?.length ?? 0} products
            </p>
            <p className="text-sm text-foreground-muted">tracked in your catalogue</p>
          </div>
          {lowStockCount > 0 && <StatusBadge tone="warning">{lowStockCount} low on stock</StatusBadge>}
        </div>
        <Link href="/products">
          <Button variant="secondary" className="w-full">
            {products?.length ? "Manage products & stock" : "Add your first product"}
          </Button>
        </Link>
      </Card>

      <div className="animate-rise-in grid grid-cols-2 gap-3">
        <Link href="/pos">
          <Button className="min-h-14 w-full">Sell</Button>
        </Link>
        <Link href="/cash-up">
          <Button variant="ghost" className="min-h-14 w-full">
            Cash-up
          </Button>
        </Link>
        <Link href="/customers">
          <Button variant="ghost" className="min-h-14 w-full">
            Customers
          </Button>
        </Link>
        <Link href="/suppliers">
          <Button variant="ghost" className="min-h-14 w-full">
            Suppliers
          </Button>
        </Link>
        {(staffUser.role === "owner" || staffUser.role === "manager") && (
          <Link href="/reports" className="col-span-2">
            <Button variant="secondary" className="min-h-14 w-full">
              Reports
            </Button>
          </Link>
        )}
      </div>
    </main>
  );
}
