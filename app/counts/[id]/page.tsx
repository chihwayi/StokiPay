import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-server";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { CountEntryForm } from "@/components/features/stock/count-entry-form";
import { CountApproval } from "@/components/features/stock/count-approval";

export default async function StockCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: count } = await supabase
    .from("stock_counts")
    .select("id, status, tenant_id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!count) notFound();

  const canApprove = staffUser.role === "owner" || staffUser.role === "manager";
  const isCounter = count.created_by === user.id;

  let body: React.ReactNode;

  if (count.status === "open") {
    if (!isCounter) {
      body = (
        <p className="text-sm text-foreground-muted">
          This count is still being entered by the staff member who started it.
        </p>
      );
    } else {
      const { data: products } = await supabase
        .from("products")
        .select("id, name, unit")
        .eq("tenant_id", staffUser.tenant_id)
        .order("name");
      body = <CountEntryForm countId={count.id} products={products ?? []} />;
    }
  } else {
    const { data: lines } = await supabase
      .from("stock_count_lines")
      .select("product_id, counted_quantity, expected_quantity, products(name)")
      .eq("stock_count_id", count.id);

    const enriched = (lines ?? []).map((l) => {
      const product = Array.isArray(l.products) ? l.products[0] : l.products;
      return {
        product_id: l.product_id,
        counted_quantity: l.counted_quantity,
        expected_quantity: l.expected_quantity,
        productName: product?.name ?? "Unknown product",
      };
    });

    if (count.status === "submitted" && canApprove) {
      body = <CountApproval countId={count.id} lines={enriched} />;
    } else {
      body = (
        <div className="flex flex-col gap-3">
          {enriched.map((l) => (
            <div key={l.product_id} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{l.productName}</span>
              <span className="text-sm text-foreground-muted">
                counted {l.counted_quantity} · expected {l.expected_quantity ?? "?"}
              </span>
            </div>
          ))}
          {count.status === "submitted" && (
            <p className="text-sm text-foreground-muted">Waiting for owner/manager approval.</p>
          )}
        </div>
      );
    }
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in flex items-center justify-between gap-4">
        <div>
          <Link href="/counts" className="text-sm font-semibold text-teal hover:underline">
            ← Stock counts
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            Count
          </h1>
        </div>
        <StatusBadge
          tone={count.status === "approved" ? "positive" : count.status === "submitted" ? "negative" : "warning"}
        >
          {count.status}
        </StatusBadge>
      </header>

      <Card accent className="animate-rise-in">
        {body}
      </Card>
    </main>
  );
}
