"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { getDeviceId } from "@/lib/sync/device-id";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Opens a till (cash_sessions row) — a plain, non-computed insert
// permitted directly under RLS (lib/db/migrations/0007.../0008...); the
// partial unique index there is what actually prevents two open sessions
// on the same branch, not this form.
export function OpenSessionForm({ tenantId, branchId }: { tenantId: string; branchId: string }) {
  const router = useRouter();
  const [floatAmount, setFloatAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(floatAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid opening float (0 if none)");
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

    const { error: insertError } = await supabase.from("cash_sessions").insert({
      tenant_id: tenantId,
      branch_id: branchId,
      device_id: deviceId,
      opened_by: user.id,
      opening_float_minor: Math.round(amount * 100),
      opening_currency: currency,
      status: "open",
    });

    setBusy(false);
    if (insertError) {
      setError(
        insertError.message.includes("cash_sessions_one_open_per_branch")
          ? "A till is already open for this branch"
          : insertError.message,
      );
      return;
    }
    router.refresh();
  }

  return (
    <Card accent className="animate-rise-in flex flex-col gap-3">
      <p className="font-display text-xl font-semibold text-foreground">Open the till</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step={0.01}
            placeholder="Opening float"
            value={floatAmount}
            onChange={(e) => setFloatAmount(e.target.value)}
            className="min-h-12 flex-1"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="min-h-12 rounded-xl border-2 border-border bg-surface px-3 text-sm"
          >
            {["ZIG", "USD", "ZAR"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {error && <span className="text-xs font-medium text-clay">{error}</span>}
        <Button type="submit" disabled={busy} className="min-h-14 w-full">
          {busy ? "Opening…" : "Open till"}
        </Button>
      </form>
    </Card>
  );
}
