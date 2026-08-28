"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { queueStockMovement } from "@/lib/sync/writes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Queues a reason-coded stock_movements 'adjustment' row (positive or
// negative) through the local-first PowerSync write path (ADR 0002/0003,
// lib/sync/writes.ts). The CHECK constraint in
// lib/db/migrations/0006_stock_rls_and_functions.sql still rejects an
// adjustment with no reason server-side, but this form can't omit one
// either.
export function AdjustStockForm({
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
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(delta);
    if (!Number.isInteger(qty) || qty === 0) {
      setError("Enter a non-zero whole number (negative for loss/damage)");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required for adjustments");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await queueStockMovement({
        tenantId,
        branchId,
        productId,
        movementType: "adjustment",
        quantityDelta: qty,
        reason: reason.trim(),
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not queue this adjustment");
      return;
    }

    setBusy(false);
    setDelta("");
    setReason("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="ghost" className="min-h-10 px-4 text-sm" onClick={() => setOpen(true)}>
        Adjust
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step={1}
          autoFocus
          placeholder="+/- qty"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          className="min-h-10 w-28"
        />
        <Input
          placeholder="Reason (e.g. damaged, shrinkage)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-10 flex-1"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy} className="min-h-10 px-4 text-sm">
          {busy ? "Saving…" : "Save adjustment"}
        </Button>
        <Button variant="ghost" type="button" className="min-h-10 px-4 text-sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <span className="text-xs font-medium text-clay">{error}</span>}
    </form>
  );
}
