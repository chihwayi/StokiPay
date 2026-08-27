"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { getDeviceId } from "@/lib/sync/device-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Logs a stock_movements 'receipt' row through the regular RLS path
// (lib/db/migrations/0006_stock_rls_and_functions.sql) — any tenant
// staff member can receive stock on their own registered device. Uses
// ADR 0003's operation_id/device_id contract; real offline queueing via
// PowerSync (ADR 0002) is a follow-up, this write goes straight to the
// server today.
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
    const deviceId = getDeviceId();
    if (!deviceId) {
      setError("Device not registered yet — reload the dashboard first");
      return;
    }

    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      setError("Session expired");
      return;
    }

    const { error: insertError } = await supabase.from("stock_movements").insert({
      tenant_id: tenantId,
      branch_id: branchId,
      product_id: productId,
      movement_type: "receipt",
      quantity_delta: qty,
      actor_staff_user_id: user.id,
      device_id: deviceId,
      operation_id: crypto.randomUUID(),
    });

    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
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
