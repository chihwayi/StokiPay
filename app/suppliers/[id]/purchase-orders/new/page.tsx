import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { NewPurchaseOrderForm } from "@/components/features/suppliers/new-purchase-order-form";

export default async function NewPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
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
  if (staffUser.role !== "owner" && staffUser.role !== "manager") redirect(`/suppliers/${id}`);

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("id", id)
    .eq("tenant_id", staffUser.tenant_id)
    .maybeSingle();
  if (!supplier) notFound();

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("is_primary", true)
    .maybeSingle();
  if (!branch) notFound();

  const { data: products } = await supabase
    .from("products")
    .select("id, name, cost_price_minor, price_currency")
    .eq("tenant_id", staffUser.tenant_id)
    .eq("is_active", true)
    .order("name");

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href={`/suppliers/${supplier.id}`} className="text-sm font-semibold text-teal hover:underline">
          ← {supplier.name}
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">New purchase order</h1>
      </header>

      <NewPurchaseOrderForm
        supplierId={supplier.id}
        branchId={branch.id}
        products={(products ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          costPriceMinor: p.cost_price_minor,
          currencyCode: p.price_currency,
        }))}
      />
    </main>
  );
}
