"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/auth/supabase-browser";
import { getOrCreateDeviceId } from "@/lib/sync/device-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

type DraftLine = {
  productName: string;
  quantity: number | null;
  unitPriceMinor: number | null;
  confidence: "high" | "medium" | "low";
};

// Photo -> AI-extracted draft -> owner/manager reviews and corrects every
// line -> stockflow_confirm_ocr_draft. No product or stock_movements row
// exists until that last explicit step (CLAUDE.md rule 6, sprints.md
// Sprint 7's first acceptance line) — this page never writes to
// products/stock_movements itself.
export default function LedgerScanPage() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return router.replace("/sign-in");

      const { data: staffUser } = await supabase
        .from("staff_users")
        .select("tenant_id, role")
        .eq("id", user.id)
        .maybeSingle();
      if (!staffUser) return router.replace("/onboarding");
      setRole(staffUser.role);

      const { data: branch } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", staffUser.tenant_id)
        .eq("is_primary", true)
        .maybeSingle();
      setBranchId(branch?.id ?? null);
    }
    load();
  }, [router]);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !branchId) return;

    setBusy(true);
    setError(null);
    setDraftId(null);
    setLines([]);

    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await fetch("/api/ai/extract-ledger-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        mediaType: file.type,
        branchId,
        deviceId: getOrCreateDeviceId(),
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Extraction failed");
      return;
    }
    setDraftId(body.draftId);
    setLines(body.lines ?? []);
    setNotes(body.notes ?? null);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function confirm() {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_confirm_ocr_draft", {
      p_draft_id: draftId,
      p_device_id: getOrCreateDeviceId(),
      p_lines: lines.map((l) => ({
        product_name: l.productName,
        quantity: l.quantity ?? 0,
        unit_cost_minor: l.unitPriceMinor ?? 0,
        sell_price_minor: l.unitPriceMinor ?? 0,
        currency_code: "USD",
      })),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push("/products");
  }

  async function reject() {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("stockflow_reject_ocr_draft", { p_draft_id: draftId });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setDraftId(null);
    setLines([]);
  }

  const canConfirm = role === "owner" || role === "manager";

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/products" className="text-sm font-semibold text-teal hover:underline">
          ← Products
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Scan a ledger page</h1>
        <p className="text-xs text-foreground-muted">
          Photograph a handwritten stock/sales page. Nothing is added to your stock until you review and confirm every line below.
        </p>
      </header>

      {!draftId && (
        <Card accent className="animate-rise-in flex flex-col items-center gap-3 py-8 text-center">
          <label className="cursor-pointer">
            <Input type="file" accept="image/*" capture="environment" onChange={onFileSelected} className="hidden" />
            <span className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-marigold px-6 text-base font-semibold text-white shadow-[0_4px_0_0_var(--marigold-strong)]">
              {busy ? "Reading photo…" : "Take or choose a photo"}
            </span>
          </label>
        </Card>
      )}

      {error && (
        <Card className="border-2 border-clay/40 text-sm text-clay">{error}</Card>
      )}

      {draftId && lines.length > 0 && (
        <div className="flex flex-col gap-3">
          {notes && <p className="text-xs text-foreground-muted">{notes}</p>}
          {lines.map((line, i) => (
            <Card key={i} className="animate-rise-in flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Input
                  value={line.productName}
                  onChange={(ev) => updateLine(i, { productName: ev.target.value })}
                  className="min-h-10 flex-1 text-sm"
                />
                <StatusBadge tone={line.confidence === "high" ? "positive" : line.confidence === "medium" ? "warning" : "negative"}>
                  {line.confidence}
                </StatusBadge>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Qty"
                  value={line.quantity ?? ""}
                  onChange={(ev) => updateLine(i, { quantity: ev.target.value === "" ? null : Number(ev.target.value) })}
                  className="min-h-10 flex-1 text-sm"
                />
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Price (cents)"
                  value={line.unitPriceMinor ?? ""}
                  onChange={(ev) => updateLine(i, { unitPriceMinor: ev.target.value === "" ? null : Number(ev.target.value) })}
                  className="min-h-10 flex-1 text-sm"
                />
              </div>
              <p className="text-xs text-foreground-muted">Set quantity to 0 to skip this misread line.</p>
            </Card>
          ))}

          {canConfirm ? (
            <div className="flex gap-3">
              <Button onClick={confirm} disabled={busy} className="flex-1">
                {busy ? "Saving…" : "Confirm & create products"}
              </Button>
              <Button variant="ghost" onClick={reject} disabled={busy} className="flex-1">
                Reject
              </Button>
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">Only an owner or manager can confirm this draft.</p>
          )}
        </div>
      )}
    </main>
  );
}
