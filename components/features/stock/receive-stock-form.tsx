"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { queueStockMovement } from "@/lib/sync/writes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Queues a stock_movements 'receipt' row through the local-first
// PowerSync write path (ADR 0002/0003, lib/sync/writes.ts) — commits to
// local SQLite immediately (works offline, survives a refresh) and
// uploads to lib/db/migrations/0006_stock_rls_and_functions.sql's RLS
// path automatically once connected.
export function ReceiveStockForm({
  productId,
  tenantId,
  branchId,
}: {
  productId: string;
  tenantId: string;
  branchId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Enter a whole number greater than zero");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await queueStockMovement({
        tenantId,
        branchId,
        productId,
        movementType: "receipt",
        quantityDelta: qty,
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not queue this receipt");
      return;
    }

    setBusy(false);
    setQuantity("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="ghost" className="min-h-10 px-4 text-sm" onClick={() => setOpen(true)}>
        + Receive stock
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        step={1}
        autoFocus
        placeholder="Qty"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="min-h-10 w-24"
      />
      <Button type="submit" disabled={busy} className="min-h-10 px-4 text-sm">
        {busy ? "Saving…" : "Save"}
      </Button>
      {error && <span className="text-xs font-medium text-clay">{error}</span>}
    </form>
  );
}
