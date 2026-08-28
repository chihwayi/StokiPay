"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Product = { id: string; name: string; costPriceMinor: number; currencyCode: string };
type Line = { productId: string; quantity: string; unitCostMinor: string };

export function NewPurchaseOrderForm({
  supplierId,
  branchId,
  products,
}: {
  supplierId: string;
  branchId: string;
  products: Product[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addProduct(p: Product) {
    if (lines.some((l) => l.productId === p.id)) return;
    setLines((prev) => [
      ...prev,
      { productId: p.id, quantity: "", unitCostMinor: (p.costPriceMinor / 100).toFixed(2) },
    ]);
  }

  function updateLine(productId: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  async function submit() {
    setError(null);
    const validLines = lines.filter((l) => Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setError("Add at least one line with a quantity");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_create_purchase_order", {
      p_branch_id: branchId,
      p_supplier_id: supplierId,
      p_lines: validLines.map((l) => ({
        product_id: l.productId,
        quantity_ordered: Number(l.quantity),
        unit_cost_minor: Math.round(Number(l.unitCostMinor) * 100),
        currency_code: currency,
      })),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(`/suppliers/${supplierId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="animate-rise-in flex flex-col gap-3">
        <p className="text-sm font-semibold text-foreground">Add products</p>
        <div className="flex flex-col gap-1">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addProduct(p)}
              disabled={lines.some((l) => l.productId === p.id)}
              className="flex items-center justify-between rounded-xl bg-surface-sunken px-3 py-2 text-left disabled:opacity-40"
            >
              <span className="text-sm font-medium text-foreground">{p.name}</span>
              <span className="text-xs text-foreground-muted">{formatMoney(p.costPriceMinor, p.currencyCode)}</span>
            </button>
          ))}
        </div>
      </Card>

      {lines.length > 0 && (
        <Card className="animate-rise-in flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Lines</p>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="min-h-10 rounded-xl border-2 border-border bg-surface px-2 text-sm"
            >
              {["ZIG", "USD", "ZAR"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {lines.map((l) => {
            const product = products.find((p) => p.id === l.productId)!;
            return (
              <div key={l.productId} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-foreground">{product.name}</span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Qty"
                  value={l.quantity}
                  onChange={(e) => updateLine(l.productId, { quantity: e.target.value })}
                  className="min-h-10 w-16 text-center"
                />
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="Unit cost"
                  value={l.unitCostMinor}
                  onChange={(e) => updateLine(l.productId, { unitCostMinor: e.target.value })}
                  className="min-h-10 w-24 text-center"
                />
                <button
                  type="button"
                  onClick={() => removeLine(l.productId)}
                  className="text-xs font-semibold text-clay"
                >
                  Remove
                </button>
              </div>
            );
          })}
          {error && <span className="text-xs font-medium text-clay">{error}</span>}
          <Button disabled={busy} onClick={submit} className="min-h-14 w-full">
            {busy ? "Creating…" : "Create purchase order"}
          </Button>
        </Card>
      )}
    </div>
  );
}
