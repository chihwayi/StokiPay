"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { getDeviceId } from "@/lib/sync/device-id";
import { createOperationId } from "@/lib/sync/operation-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const TENDER_TYPES = ["cash", "mobile_money", "card", "bank_transfer"];

// Records a debt repayment via stockflow_record_customer_payment
// (lib/db/migrations/0011...) — a standalone payment, not tied to a
// specific sale, that still flows into cash-up reconciliation.
export function RepaymentForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [tenderType, setTenderType] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a positive amount");
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
    const { error: rpcError } = await supabase.rpc("stockflow_record_customer_payment", {
      p_operation_id: createOperationId(),
      p_customer_id: customerId,
      p_device_id: deviceId,
      p_amount_minor: Math.round(amountValue * 100),
      p_currency_code: currency,
      p_tender_type: tenderType,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setAmount("");
    router.refresh();
  }

  return (
    <Card className="animate-rise-in flex flex-col gap-3">
      <p className="font-display text-lg font-semibold text-foreground">Record a repayment</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step={0.01}
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="min-h-11 flex-1"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="min-h-11 rounded-xl border-2 border-border bg-surface px-3 text-sm"
          >
            {["ZIG", "USD", "ZAR"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <select
          value={tenderType}
          onChange={(e) => setTenderType(e.target.value)}
          className="min-h-11 rounded-xl border-2 border-border bg-surface px-3 text-sm"
        >
          {TENDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
        {error && <span className="text-xs font-medium text-clay">{error}</span>}
        <Button type="submit" disabled={busy} className="min-h-12">
          {busy ? "Recording…" : "Record repayment"}
        </Button>
      </form>
    </Card>
  );
}
