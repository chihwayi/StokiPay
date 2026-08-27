"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export default function NewProductPage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("each");
  const [barcode, setBarcode] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: staffUser } = await supabase
      .from("staff_users")
      .select("tenant_id")
      .eq("id", user?.id ?? "")
      .maybeSingle();

    if (!staffUser) {
      setBusy(false);
      setError("Session expired — please sign in again.");
      return;
    }

    const { error: insertError } = await supabase.from("products").insert({
      tenant_id: staffUser.tenant_id,
      name,
      unit,
      barcode: barcode || null,
      cost_price_minor: Math.round(Number(costPrice || 0) * 100),
      sell_price_minor: Math.round(Number(sellPrice || 0) * 100),
      low_stock_threshold: Number(lowStockThreshold) || 0,
    });

    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    router.push("/products");
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div className="animate-rise-in flex flex-col gap-1">
        <Link href="/products" className="text-sm font-semibold text-teal hover:underline">
          ← Products
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          New product
        </h1>
      </div>

      <Card accent className="animate-rise-in">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Product name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="2L Cooking Oil" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="each" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="barcode">Barcode</Label>
              <Input id="barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cost">Cost price (USD)</Label>
              <Input id="cost" type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sell">Sell price (USD)</Label>
              <Input id="sell" type="number" min={0} step="0.01" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="threshold">Low-stock alert threshold</Label>
            <Input
              id="threshold"
              type="number"
              min={0}
              step={1}
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Add product"}
          </Button>
        </form>
        {error && <p className="mt-3 text-sm font-medium text-clay">{error}</p>}
      </Card>
    </main>
  );
}
