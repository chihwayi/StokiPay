"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";

// Any tenant staff can dismiss (stockflow_dismiss_alert, migration
// 0019) — dismissing only marks the alert reviewed, it never resolves
// the underlying stock_conflict/cash_variance/debt itself.
export function DismissAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dismiss() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_dismiss_alert", { p_alert_id: alertId });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" onClick={dismiss} disabled={busy} className="min-h-9 px-3 text-xs">
        {busy ? "Dismissing…" : "Dismiss"}
      </Button>
      {error && <span className="text-xs font-medium text-clay">{error}</span>}
    </div>
  );
}
