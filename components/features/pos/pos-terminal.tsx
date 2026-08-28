"use client";

import { useMemo, useState } from "react";
import { queueSale, type SalePaymentInput } from "@/lib/sync/writes";
import { formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

type Product = {
  id: string;
  name: string;
  unit: string;
  barcode: string | null;
  sellPriceMinor: number;
  currencyCode: string;
};

type CartLine = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  currencyCode: string;
};

const TENDER_TYPES: { value: SalePaymentInput["tenderType"]; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
];

// Client-first POS cart (Sprint 3). Checkout queues a single local
// PowerSync write (lib/sync/writes.ts's queueSale) — commits offline
// immediately, uploads and resolves currency/rate/idempotency
// server-side via stockflow_create_sale whenever connectivity allows
// (ADR 0002/0003/0004).
export function PosTerminal({
  branchId,
  reportingCurrency,
  products,
  customers,
}: {
  branchId: string;
  reportingCurrency: string;
  products: Product[];
  customers: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tenders, setTenders] = useState<
    { tenderType: SalePaymentInput["tenderType"]; amount: string; currencyCode: string }[]
  >([{ tenderType: "cash", amount: "", currencyCode: reportingCurrency }]);
  const [creditCustomerId, setCreditCustomerId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ operationId: string; totalMinor: number; currency: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase() === q)
      .slice(0, 8);
  }, [search, products]);

  const cartCurrency = cart[0]?.currencyCode ?? null;
  const mixedCurrency = cart.some((l) => l.currencyCode !== cartCurrency);
  const subtotalMinor = cart.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);

  function addToCart(p: Product) {
    setReceipt(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, quantity: 1, unitPriceMinor: p.sellPriceMinor, currencyCode: p.currencyCode },
      ];
    });
    setSearch("");
  }

  function setQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((l) => l.productId !== productId));
      return;
    }
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)));
  }

  function addTender() {
    setTenders((prev) => [...prev, { tenderType: "cash", amount: "", currencyCode: reportingCurrency }]);
  }

  async function checkout() {
    setError(null);
    if (cart.length === 0) {
      setError("Cart is empty");
      return;
    }
    if (mixedCurrency) {
      setError("All items in one sale must share the same currency for now");
      return;
    }
    const payments = tenders
      .filter((t) => Number(t.amount) > 0)
      .map((t) => ({
        tenderType: t.tenderType,
        amountMinor: Math.round(Number(t.amount) * 100),
        currencyCode: t.currencyCode,
      }));
    // Without a customer on credit, payments must fully cover the sale
    // (stockflow_create_sale enforces this server-side too). With a
    // customer selected, a shortfall becomes their unpaid balance — zero
    // tender is a valid fully-on-credit sale.
    if (payments.length === 0 && !creditCustomerId) {
      setError("Enter at least one tender amount, or select a customer to sell on credit");
      return;
    }

    setBusy(true);
    try {
      const result = await queueSale({
        branchId,
        currencyCode: cartCurrency!,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor })),
        payments,
        customerId: creditCustomerId || undefined,
      });
      setReceipt({ operationId: result.operationId, totalMinor: subtotalMinor, currency: cartCurrency! });
      setCart([]);
      setTenders([{ tenderType: "cash", amount: "", currencyCode: reportingCurrency }]);
      setCreditCustomerId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue this sale");
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <Card accent className="animate-rise-in flex flex-col items-center gap-3 py-10 text-center">
        <StatusBadge tone="positive">Sale queued</StatusBadge>
        <p className="font-display text-2xl font-semibold text-foreground">
          {formatMoney(receipt.totalMinor, receipt.currency)}
        </p>
        <p className="max-w-xs text-xs text-foreground-muted">
          Works offline — it will sync automatically once connected. Reference: {receipt.operationId.slice(0, 8)}
        </p>
        <Button className="mt-2 min-h-11 px-5 text-sm" onClick={() => setReceipt(null)}>
          New sale
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="animate-rise-in flex flex-col gap-3">
        <Input
          placeholder="Search by name or scan barcode"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-12"
          autoFocus
        />
        {search && (
          <div className="flex flex-col gap-1">
            {filtered.length === 0 && <p className="text-xs text-foreground-muted">No matching product</p>}
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p)}
                className="flex items-center justify-between rounded-xl bg-surface-sunken px-3 py-2 text-left hover:bg-marigold-soft"
              >
                <span className="text-sm font-medium text-foreground">{p.name}</span>
                <span className="text-xs text-foreground-muted">{formatMoney(p.sellPriceMinor, p.currencyCode)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {cart.length > 0 && (
        <Card className="animate-rise-in flex flex-col gap-3">
          {cart.map((l) => (
            <div key={l.productId} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{l.name}</p>
                <p className="text-xs text-foreground-muted">{formatMoney(l.unitPriceMinor, l.currencyCode)} each</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={l.quantity}
                  onChange={(e) => setQuantity(l.productId, Number(e.target.value))}
                  className="min-h-10 w-16 text-center"
                />
                <span className="w-20 text-right text-sm font-semibold text-foreground">
                  {formatMoney(l.quantity * l.unitPriceMinor, l.currencyCode)}
                </span>
              </div>
            </div>
          ))}
          {mixedCurrency && (
            <StatusBadge tone="negative">Mixed currencies in cart — remove some items</StatusBadge>
          )}
          <div className="flex items-center justify-between border-t-2 border-border pt-3">
            <span className="font-display text-lg font-semibold text-foreground">Total</span>
            <span className="font-display text-lg font-semibold text-foreground">
              {cartCurrency ? formatMoney(subtotalMinor, cartCurrency) : "—"}
            </span>
          </div>
        </Card>
      )}

      {cart.length > 0 && (
        <Card className="animate-rise-in flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Tender</p>
          {tenders.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={t.tenderType}
                onChange={(e) =>
                  setTenders((prev) =>
                    prev.map((x, idx) => (idx === i ? { ...x, tenderType: e.target.value as SalePaymentInput["tenderType"] } : x)),
                  )
                }
                className="min-h-11 rounded-xl border-2 border-border bg-surface px-2 text-sm"
              >
                {TENDER_TYPES.map((tt) => (
                  <option key={tt.value} value={tt.value}>
                    {tt.label}
                  </option>
                ))}
              </select>
              <select
                value={t.currencyCode}
                onChange={(e) =>
                  setTenders((prev) => prev.map((x, idx) => (idx === i ? { ...x, currencyCode: e.target.value } : x)))
                }
                className="min-h-11 rounded-xl border-2 border-border bg-surface px-2 text-sm"
              >
                {["ZIG", "USD", "ZAR"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={t.amount}
                onChange={(e) =>
                  setTenders((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))
                }
                className="min-h-11 flex-1"
              />
            </div>
          ))}
          {customers.length > 0 && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground-muted">
              Sell on credit to (optional — shortfall becomes their balance)
              <select
                value={creditCustomerId}
                onChange={(e) => setCreditCustomerId(e.target.value)}
                className="min-h-11 rounded-xl border-2 border-border bg-surface px-3 text-sm text-foreground"
              >
                <option value="">— full payment, no credit —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="ghost" type="button" className="min-h-10 self-start px-4 text-xs" onClick={addTender}>
            + Split tender
          </Button>
          {error && <span className="text-xs font-medium text-clay">{error}</span>}
          <Button disabled={busy} onClick={checkout} className="min-h-14 w-full">
            {busy ? "Queuing…" : "Complete sale"}
          </Button>
        </Card>
      )}
    </div>
  );
}
