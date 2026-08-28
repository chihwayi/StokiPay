import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { ReturnForm } from "@/components/features/returns/return-form";

export default async function ReturnSalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
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

  const { data: sale } = await supabase
    .from("sales")
    .select("id, amount_minor, currency_code, created_at")
    .eq("id", saleId)
    .eq("tenant_id", staffUser.tenant_id)
    .maybeSingle();
  if (!sale) notFound();

  const { data: items } = await supabase
    .from("sale_items")
    .select("id, product_id, quantity, unit_price_minor, currency_code, products(name)")
    .eq("sale_id", saleId);

  const { data: alreadyReturned } = await supabase
    .from("return_items")
    .select("sale_item_id, quantity")
    .in("sale_item_id", (items ?? []).map((i) => i.id));

  const returnedByLine = new Map<string, number>();
  for (const r of alreadyReturned ?? []) {
    returnedByLine.set(r.sale_item_id, (returnedByLine.get(r.sale_item_id) ?? 0) + r.quantity);
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/returns" className="text-sm font-semibold text-teal hover:underline">
          ← Returns
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Return sale</h1>
        <p className="text-xs text-foreground-muted">{new Date(sale.created_at).toLocaleString()}</p>
      </header>

      <ReturnForm
        originalSaleId={sale.id}
        currencyCode={sale.currency_code}
        lines={(items ?? []).map((i) => ({
          saleItemId: i.id,
          productName: (i.products as unknown as { name: string } | null)?.name ?? "Item",
          quantity: i.quantity,
          alreadyReturned: returnedByLine.get(i.id) ?? 0,
          unitPriceMinor: i.unit_price_minor,
        }))}
      />
    </main>
  );
}
