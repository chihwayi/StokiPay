import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Button } from "@/components/ui/button";
import { PosTerminal } from "@/components/features/pos/pos-terminal";

export default async function PosPage() {
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

  const { data: tenant } = await supabase
    .from("tenants")
    .select("reporting_currency")
    .eq("id", staffUser.tenant_id)
    .maybeSingle();

  const { data: branch } = await supabase
    .from("branches")
    .select("id, name")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("is_primary", true)
    .maybeSingle();

  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit, barcode, sell_price_minor, price_currency")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("is_active", true)
    .order("name");

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .eq("tenant_id", staffUser.tenant_id)
    .order("name");

  if (!branch) {
    return (
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
        <p className="text-sm text-foreground-muted">No branch set up yet.</p>
        <Link href="/dashboard">
          <Button variant="ghost">← Dashboard</Button>
        </Link>
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
            ← Dashboard
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Sell</h1>
        </div>
        <Link href="/returns">
          <Button variant="ghost" className="min-h-11 px-4 text-sm">
            Returns
          </Button>
        </Link>
      </header>

      <PosTerminal
        branchId={branch.id}
        reportingCurrency={tenant?.reporting_currency ?? "USD"}
        products={(products ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unit,
          barcode: p.barcode,
          sellPriceMinor: p.sell_price_minor,
          currencyCode: p.price_currency,
        }))}
        customers={customers ?? []}
      />
    </main>
  );
}
