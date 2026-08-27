"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The counting staff member enters what they physically counted for
// each product with NO visibility into what the system expects — the
// RLS policy on stock_count_lines (0006_stock_rls_and_functions.sql)
// rejects any insert that tries to set expected_quantity, and this form
// never fetches stock_levels at all. stockflow_submit_stock_count fills
// expected_quantity in server-side, after entry is done.
export function CountEntryForm({
  countId,
  products,
}: {
  countId: string;
  products: { id: string; name: string; unit: string }[];
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const entries = Object.entries(counts).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) {
      setError("Enter at least one counted quantity");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const rows = entries.map(([productId, value]) => ({
      stock_count_id: countId,
      product_id: productId,
      counted_quantity: Number(value),
    }));

    const { error: insertError } = await supabase.from("stock_count_lines").insert(rows);
    if (insertError) {
      setBusy(false);
      setError(insertError.message);
      return;
    }

    const { error: submitError } = await supabase.rpc("stockflow_submit_stock_count", {
      p_stock_count_id: countId,
    });
    setBusy(false);
    if (submitError) {
      setError(submitError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {products.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">{p.name}</span>
          <Input
            type="number"
            min={0}
            step={1}
            placeholder={`Qty (${p.unit})`}
            value={counts[p.id] ?? ""}
            onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
            className="min-h-10 w-28 text-right"
          />
        </div>
      ))}
      <Button onClick={submit} disabled={busy} className="mt-2 w-full">
        {busy ? "Submitting…" : "Submit count"}
      </Button>
      {error && <p className="text-sm font-medium text-clay">{error}</p>}
    </div>
  );
}
