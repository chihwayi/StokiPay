"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

type Variance = {
  id: string;
  cash_session_id: string;
  tender_type: string;
  currency_code: string;
  expected_amount_minor: number;
  counted_amount_minor: number;
  variance_minor: number;
  reason: string | null;
};

// Owner/manager sign-off on an over/short flagged beyond the tenant's
// threshold (stockflow_review_cash_variance, lib/db/migrations/0008...).
export function VarianceReview({ variances }: { variances: Variance[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(id: string) {
    setError(null);
    setBusyId(id);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_review_cash_variance", { p_cash_variance_id: id });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card className="animate-rise-in flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="font-display text-lg font-semibold text-foreground">Variances needing review</p>
        <StatusBadge tone="negative">{variances.length}</StatusBadge>
      </div>
      {variances.map((v) => (
        <div key={v.id} className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium capitalize text-foreground">
              {v.tender_type.replace("_", " ")} · {v.currency_code}
            </span>
            <span className="text-sm font-semibold text-clay">{formatMoney(v.variance_minor, v.currency_code)}</span>
          </div>
          <p className="text-xs text-foreground-muted">
            Expected {formatMoney(v.expected_amount_minor, v.currency_code)}, counted{" "}
            {formatMoney(v.counted_amount_minor, v.currency_code)}
          </p>
          {v.reason && <p className="text-xs text-foreground-muted">Reason: {v.reason}</p>}
          <Button
            variant="ghost"
            disabled={busyId === v.id}
            onClick={() => review(v.id)}
            className="min-h-10 self-start px-4 text-xs"
          >
            {busyId === v.id ? "Marking reviewed…" : "Mark reviewed"}
          </Button>
        </div>
      ))}
      {error && <span className="text-xs font-medium text-clay">{error}</span>}
    </Card>
  );
}
