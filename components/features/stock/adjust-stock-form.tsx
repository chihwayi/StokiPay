"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { getDeviceId } from "@/lib/sync/device-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Logs a reason-coded stock_movements 'adjustment' row (positive or
// negative) — the CHECK constraint in
// lib/db/migrations/0006_stock_rls_and_functions.sql rejects an
// adjustment with no reason, so this form can't omit one.
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
      movement_type: "adjustment",
      quantity_delta: qty,
      reason: reason.trim(),
      actor_staff_user_id: user.id,
      device_id: deviceId,
      operation_id: crypto.randomUUID(),
    });

    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
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
