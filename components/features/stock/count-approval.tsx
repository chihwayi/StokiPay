"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type Line = {
  product_id: string;
  counted_quantity: number;
  expected_quantity: number | null;
  productName: string;
};

// Owner/manager-only review of a submitted count. Approving turns every
// non-zero variance into a reason-coded stock_movements row atomically
// (stockflow_approve_stock_count) — RLS rejects the call for non-owner/
// manager roles regardless of what this UI shows.
export function CountApproval({ countId, lines }: { countId: string; lines: Line[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: approveError } = await supabase.rpc("stockflow_approve_stock_count", {
      p_stock_count_id: countId,
    });
    setBusy(false);
    if (approveError) {
      setError(approveError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {lines.map((l) => {
        const variance = l.counted_quantity - (l.expected_quantity ?? 0);
        return (
          <div key={l.product_id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{l.productName}</p>
              <p className="text-xs text-foreground-muted">
                counted {l.counted_quantity} · expected {l.expected_quantity ?? 0}
              </p>
            </div>
            {variance !== 0 && (
              <StatusBadge tone={variance > 0 ? "positive" : "negative"}>
                {variance > 0 ? "+" : ""}
                {variance}
              </StatusBadge>
            )}
          </div>
        );
      })}
      <Button onClick={approve} disabled={busy} className="mt-2 w-full">
        {busy ? "Approving…" : "Approve variances"}
      </Button>
      {error && <p className="text-sm font-medium text-clay">{error}</p>}
    </div>
  );
}
