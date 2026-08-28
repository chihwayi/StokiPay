"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { getDeviceId } from "@/lib/sync/device-id";
import { createOperationId } from "@/lib/sync/operation-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Line = { productId: string; productName: string; quantityOrdered: number };

// Records what actually arrived (which may differ from what was
// ordered — the discrepancy is just quantity_ordered vs
// quantity_received sitting side by side, not a separate flag) and
// allocates freight/other costs into a landed unit cost via
// stockflow_receive_purchase_order (lib/db/migrations/0012...).
export function ReceivePurchaseOrderForm({
  purchaseOrderId,
  lines,
  currencyCode,
}: {
  purchaseOrderId: string;
  lines: Line[];
  currencyCode: string;
}) {
  const router = useRouter();
  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.productId, String(l.quantityOrdered)])),
  );
  const [freight, setFreight] = useState("0");
  const [other, setOther] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const deviceId = getDeviceId();
    if (!deviceId) {
      setError("Device not registered yet — reload the dashboard first");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_receive_purchase_order", {
      p_operation_id: createOperationId(),
      p_purchase_order_id: purchaseOrderId,
      p_device_id: deviceId,
      p_lines: lines.map((l) => ({
        product_id: l.productId,
        quantity_received: Number(received[l.productId] ?? 0),
      })),
      p_freight_cost_minor: Math.round(Number(freight || 0) * 100),
      p_other_cost_minor: Math.round(Number(other || 0) * 100),
      p_currency_code: currencyCode,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card className="animate-rise-in flex flex-col gap-3">
      <p className="font-display text-lg font-semibold text-foreground">Receive delivery</p>
      {lines.map((l) => (
        <div key={l.productId} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-foreground">{l.productName}</p>
            <p className="text-xs text-foreground-muted">ordered {l.quantityOrdered}</p>
          </div>
          <Input
            type="number"
            min={0}
            step={1}
            value={received[l.productId] ?? ""}
            onChange={(e) => setReceived((prev) => ({ ...prev, [l.productId]: e.target.value }))}
            className="min-h-10 w-20 text-center"
          />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={0.01}
          placeholder="Freight cost"
          value={freight}
          onChange={(e) => setFreight(e.target.value)}
          className="min-h-11 flex-1"
        />
        <Input
          type="number"
          min={0}
          step={0.01}
          placeholder="Other cost"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          className="min-h-11 flex-1"
        />
      </div>
      {error && <span className="text-xs font-medium text-clay">{error}</span>}
      <Button disabled={busy} onClick={submit} className="min-h-14 w-full">
        {busy ? "Receiving…" : "Confirm receipt"}
      </Button>
    </Card>
  );
}
