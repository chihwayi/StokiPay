"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

type CountLine = { tenderType: string; currencyCode: string; counted: string; reason: string };

const TENDER_TYPES = ["cash", "mobile_money", "card", "bank_transfer"];
const CURRENCIES = ["ZIG", "USD", "ZAR"];

// Closes a till: submits a physical count per tender/currency combo used
// during the session (plus always cash/opening_currency for the float),
// via stockflow_close_cash_session (lib/db/migrations/0008...) which
// computes expected vs counted server-side and flags a review-required
// variance when it exceeds the tenant's threshold.
export function CloseSessionForm({
  cashSessionId,
  openingFloatMinor,
  openingCurrency,
  openedAt,
}: {
  cashSessionId: string;
  openingFloatMinor: number;
  openingCurrency: string;
  openedAt: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<CountLine[]>([
    { tenderType: "cash", currencyCode: openingCurrency, counted: "", reason: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadUsedTenders() {
      const supabase = createClient();
      const { data } = await supabase
        .from("payments")
        .select("tender_type, currency_code")
        .eq("cash_session_id", cashSessionId);
      if (cancelled || !data) return;
      const seen = new Set(lines.map((l) => `${l.tenderType}:${l.currencyCode}`));
      const extra: CountLine[] = [];
      for (const p of data) {
        const key = `${p.tender_type}:${p.currency_code}`;
        if (!seen.has(key)) {
          seen.add(key);
          extra.push({ tenderType: p.tender_type, currencyCode: p.currency_code, counted: "", reason: "" });
        }
      }
      if (extra.length) setLines((prev) => [...prev, ...extra]);
    }
    loadUsedTenders();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashSessionId]);

  function addLine() {
    setLines((prev) => [...prev, { tenderType: "cash", currencyCode: "USD", counted: "", reason: "" }]);
  }

  function updateLine(i: number, patch: Partial<CountLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError(null);
    const supabase = createClient();
    const counts = lines
      .filter((l) => l.counted.trim() !== "")
      .map((l) => ({
        tender_type: l.tenderType,
        currency_code: l.currencyCode,
        counted_amount_minor: Math.round(Number(l.counted) * 100),
        reason: l.reason.trim() || undefined,
      }));
    if (counts.length === 0) {
      setError("Enter at least one counted amount");
      return;
    }

    setBusy(true);
    const { error: rpcError } = await supabase.rpc("stockflow_close_cash_session", {
      p_cash_session_id: cashSessionId,
      p_counts: counts,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card accent className="animate-rise-in flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl font-semibold text-foreground">Close the till</p>
        <StatusBadge tone="warning">Open since {new Date(openedAt).toLocaleTimeString()}</StatusBadge>
      </div>
      <p className="text-xs text-foreground-muted">
        Opening float: {openingCurrency} {(openingFloatMinor / 100).toFixed(2)}
      </p>

      <div className="flex flex-col gap-3">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl bg-surface-sunken p-3">
            <div className="flex items-center gap-2">
              <select
                value={l.tenderType}
                onChange={(e) => updateLine(i, { tenderType: e.target.value })}
                className="min-h-11 rounded-xl border-2 border-border bg-surface px-2 text-sm"
              >
                {TENDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={l.currencyCode}
                onChange={(e) => updateLine(i, { currencyCode: e.target.value })}
                className="min-h-11 rounded-xl border-2 border-border bg-surface px-2 text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="Counted"
                value={l.counted}
                onChange={(e) => updateLine(i, { counted: e.target.value })}
                className="min-h-11 flex-1"
              />
            </div>
            <Input
              placeholder="Reason if over/short (required beyond threshold)"
              value={l.reason}
              onChange={(e) => updateLine(i, { reason: e.target.value })}
              className="min-h-10 text-sm"
            />
          </div>
        ))}
      </div>

      <Button variant="ghost" type="button" className="min-h-10 self-start px-4 text-xs" onClick={addLine}>
        + Add tender/currency
      </Button>

      {error && <span className="text-xs font-medium text-clay">{error}</span>}
      <Button disabled={busy} onClick={submit} className="min-h-14 w-full">
        {busy ? "Closing…" : "Close till"}
      </Button>
    </Card>
  );
}
