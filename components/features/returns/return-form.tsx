"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { queueReturn } from "@/lib/sync/writes";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

type Line = {
  saleItemId: string;
  productName: string;
  quantity: number;
  alreadyReturned: number;
  unitPriceMinor: number;
};

const TENDER_TYPES: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
];

// Queues a return (linked reversal, never mutates the original sale —
// CLAUDE.md rule 2) through the local-first PowerSync write path.
export function ReturnForm({
  originalSaleId,
  currencyCode,
  lines,
}: {
  originalSaleId: string;
  currencyCode: string;
  lines: Line[];
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [refundTenderType, setRefundTenderType] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const returnable = lines.filter((l) => l.quantity - l.alreadyReturned > 0);
  const selected = returnable
    .map((l) => ({ line: l, quantity: quantities[l.saleItemId] ?? 0 }))
    .filter((s) => s.quantity > 0);
  const refundTotalMinor = selected.reduce((s, x) => s + x.quantity * x.line.unitPriceMinor, 0);

  async function submit() {
    setError(null);
    if (selected.length === 0) {
      setError("Select at least one item to return");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required for a return");
      return;
    }

    setBusy(true);
    try {
      await queueReturn({
        originalSaleId,
        reason: reason.trim(),
        refundTenderType: refundTenderType as "cash" | "mobile_money" | "card" | "bank_transfer",
        items: selected.map((s) => ({ saleItemId: s.line.saleItemId, quantity: s.quantity })),
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue this return");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card accent className="animate-rise-in flex flex-col items-center gap-3 py-10 text-center">
        <StatusBadge tone="positive">Return queued</StatusBadge>
        <p className="max-w-xs text-xs text-foreground-muted">
          Restocks and refunds automatically once synced — the original sale is never changed.
        </p>
        <Button className="mt-2 min-h-11 px-5 text-sm" onClick={() => router.push("/returns")}>
          Done
        </Button>
      </Card>
    );
  }

  if (returnable.length === 0) {
    return (
      <Card className="animate-rise-in flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-foreground-muted">Every line on this sale has already been fully returned.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="animate-rise-in flex flex-col gap-3">
        {returnable.map((l) => {
          const max = l.quantity - l.alreadyReturned;
          return (
            <div key={l.saleItemId} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{l.productName}</p>
                <p className="text-xs text-foreground-muted">
                  {max} of {l.quantity} returnable · {formatMoney(l.unitPriceMinor, currencyCode)} each
                </p>
              </div>
              <Input
                type="number"
                min={0}
                max={max}
                step={1}
                value={quantities[l.saleItemId] ?? 0}
                onChange={(e) =>
                  setQuantities((prev) => ({
                    ...prev,
                    [l.saleItemId]: Math.max(0, Math.min(max, Number(e.target.value))),
                  }))
                }
                className="min-h-10 w-16 text-center"
              />
            </div>
          );
        })}
      </Card>

      <Card className="animate-rise-in flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
          Reason
          <Input
            placeholder="e.g. customer changed mind, wrong item"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-11"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
          Refund via
          <select
            value={refundTenderType}
            onChange={(e) => setRefundTenderType(e.target.value)}
            className="min-h-11 rounded-xl border-2 border-border bg-surface px-3 text-sm"
          >
            {TENDER_TYPES.map((tt) => (
              <option key={tt.value} value={tt.value}>
                {tt.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between border-t-2 border-border pt-3">
          <span className="font-display text-lg font-semibold text-foreground">Refund total</span>
          <span className="font-display text-lg font-semibold text-foreground">
            {formatMoney(refundTotalMinor, currencyCode)}
          </span>
        </div>
        {error && <span className="text-xs font-medium text-clay">{error}</span>}
        <Button disabled={busy} onClick={submit} className="min-h-14 w-full">
          {busy ? "Queuing…" : "Confirm return"}
        </Button>
      </Card>
    </div>
  );
}
