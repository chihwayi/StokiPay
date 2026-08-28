# Sprint 4 Handoff — Customers, Suppliers, Credit & Mobile-Money Reconciliation

## Status

`complete, Paynow unverified against a live sandbox`

## Scope delivered

- `customers`, `suppliers`, `customer_ledger`, `supplier_ledger` — append-only, balance is always `sum(ledger.reporting_amount_minor)` for a customer/supplier, never a stored column, so it's reconstructable from history by construction (same discipline as `stock_movements`/`sales`).
- `stockflow_create_sale` (Sprint 3) extended with an optional `p_customer_id`: with a customer, payments may fall short of the sale total and the shortfall becomes a `customer_ledger` `credit_sale` entry instead of being rejected; without one, behavior is unchanged from Sprint 3 (full payment required). **Real bug found and fixed during this extension**: `create or replace function` with a different parameter count creates a second overload instead of replacing the original — the Sprint 3 6-parameter version was still live alongside the new 7-parameter one until migration `0013` explicitly dropped it. Left unfixed, this risked PostgREST resolving the wrong overload depending on how a client's RPC call was shaped.
- `stockflow_record_customer_payment` / `stockflow_pay_supplier` — standalone debt repayments/supplier payments, not tied to a specific sale. Both post a `payments` row (so they still flow into cash-up reconciliation, same as any other tender) and a signed ledger entry. **A second real bug found and fixed** (migration `0014`): the first version returned a different id on a fresh call (`payments.id`) than on an idempotent replay (`customer_ledger.id`/`supplier_ledger.id`) — caught by the replay test in `tests/integration/customers-suppliers.test.ts`, not by manual testing.
- `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines` — `stockflow_create_purchase_order` (owner/manager only) and `stockflow_receive_purchase_order`, which records what actually arrived (ordered vs received sit side by side per line, not a separate discrepancy flag), allocates freight/other landed costs proportionally by received value across lines, updates `products.cost_price_minor` **going forward only** (a prior sale's `sale_items.unit_cost_price_minor` snapshot from Sprint 3 is untouched — proven directly in this sprint's tests, ahead of Sprint 5 needing it), and posts one `supplier_ledger` `purchase` entry for the full landed cost.
- `payments` table widened: `sale_id`/`actor_staff_user_id`/`device_id` are now nullable (a customer-repayment or Paynow-reconciled payment has no sale/staff/device), `customer_id`/`supplier_id` added, and a `payments_exactly_one_reference_check` CHECK ensures every payment row is still attributable to exactly one of a sale, customer, or supplier.
- Paynow adapter (`lib/integrations/paynow.ts`): hash computation/verification matching Paynow's publicly documented scheme, status mapping, initiate/poll helpers with a dev-fallback "not configured" result when credentials aren't set (mirrors `lib/integrations/sms.ts`'s pattern — cash/manual tender at the till is never blocked by this). Webhook receiver (`app/api/payments/paynow-webhook/route.ts`) verifies every inbound call, logs it to `provider_webhook_log` **regardless of validity** (an invalid signature is rejected AND audited, not silently dropped), and reconciles a confirmed payment via `stockflow_reconcile_provider_payment` (migration `0015`, service-role only — a webhook has no signed-in staff member, so it can't use `stockflow_auth_*()`), which is idempotent: a duplicate webhook for an already-terminal `provider_payments` row is a no-op.
- UI: `/customers` + `/customers/[id]` (balance, ledger history, repayment form), `/suppliers` + `/suppliers/[id]` (balance, ledger, pay-supplier form, purchase order list), `/suppliers/[id]/purchase-orders/new` and `/[poId]` (create PO, receive delivery with freight/other cost entry). POS terminal gained an optional "sell on credit to" customer selector, wired through `lib/sync/{schema,writes,connector}.ts` so a credit sale is still a local-first PowerSync write like any other sale.
- 11 new integration tests (`tests/integration/customers-suppliers.test.ts`) + 9 new unit tests (`tests/unit/paynow.test.ts`).

## Paynow — not verified against a live sandbox

Per the owner's explicit decision this sprint (no Paynow merchant/sandbox credentials were available), the entire Paynow surface — hash algorithm, webhook receiver, reconciliation state machine — is built and tested against **synthetic, self-signed payloads only**. `lib/integrations/paynow.ts`'s file header states this plainly. What this proves: our own signature verification correctly accepts a validly-signed payload and rejects a tampered/wrong-key/missing-hash one, and the reconciliation RPC is idempotent under a duplicate call. What it does **not** prove: that our hash concatenation order, field naming, or endpoint URLs actually match Paynow's real API today — the algorithm implemented is the long-standing publicly documented one used by every community SDK, but has not been exercised against a real request/response. Do not represent this as a working payment integration to a real business owner until it's run against Paynow's actual sandbox.

## Acceptance evidence

| Criterion | Evidence | Result |
|---|---|---|
| Customer and supplier balances are reconstructable from ledger entries | `tests/integration/customers-suppliers.test.ts` — every balance assertion sums ledger rows, never reads a stored balance column (there isn't one) | Pass |
| Credit sale reduces stock immediately and creates the appropriate unpaid ledger balance | `tests/integration/customers-suppliers.test.ts` — "a credit sale reduces stock immediately..." | Pass |
| Partial repayment updates the balance without editing historical entries | `tests/integration/customers-suppliers.test.ts` — "a partial repayment updates the balance..." (asserts the prior ledger row is byte-identical after) | Pass |
| Sandbox payment completes request → verified webhook or poll → reconciled payment; duplicate webhook changes nothing | Reconciliation idempotency proven against a synthetic `provider_payments` row (`tests/integration/customers-suppliers.test.ts`); the "sandbox payment completes" half is **not** evidenced — no real Paynow sandbox request was made this sprint | Partial — reconciliation/idempotency proven, live sandbox request unproven |
| Invalid webhook signature is rejected and audited | `tests/unit/paynow.test.ts` (rejection logic) + `app/api/payments/paynow-webhook/route.ts` logs every call to `provider_webhook_log` before checking validity | Pass at the unit/code level; not exercised against a real Paynow-signed webhook |

## Verification run

```text
npm run lint            → pass
npm run typecheck       → pass
npm run test             (unit)        → 19/19 pass (operation-id, money, paynow)
npm run test:integration (RLS)         → 14/14 pass
npm run test:integration (Stock)       → 9/9 pass
npm run test:integration (Sales/etc.)  → 11/11 pass
npm run test:integration (Customers/Suppliers) → 11/11 pass
npm run test:e2e         → 2/2 pass
npm run build            → 25 routes compiled
Date: 2026-08-28
```

Run individually per file (documented tunnel-concurrency limitation carried over from Sprint 3's handoff — unrelated to this sprint's code). No GitHub Actions used or relied on, per the owner's standing instruction.

## Changed surfaces

- Migrations: `0010` (tables, drizzle-kit-generated), `0011` (customers/suppliers RLS + credit-sale extension + repayment RPC), `0012` (purchase orders/receiving/supplier payment RPCs), `0013` (drops the stale `stockflow_create_sale` overload — real bug fix), `0014` (fixes the repayment/pay-supplier replay return-value bug), `0015` (`payments` nullable columns + Paynow reconciliation RPC).
- Environment variables: `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY` — referenced in `lib/integrations/paynow.ts` but **not set anywhere** (no credentials available); `.env.example` still cannot be edited by this assistant (standing sandbox restriction since Sprint 0).
- Routes/components: `/customers`, `/customers/[id]`, `/suppliers`, `/suppliers/[id]`, `/suppliers/[id]/purchase-orders/{new,[poId]}`, `/api/payments/paynow-webhook`; `components/features/{customers,suppliers}/*`; `pos-terminal.tsx` gained the credit-customer selector.
- Services/integrations: `lib/integrations/paynow.ts` (new).

## Decisions and limitations

- ADRs: none new — nothing here changed a locked cross-cutting decision.
- Known limitations:
  - **Paynow is unverified**, as detailed above — the single biggest gap against this sprint's acceptance criteria as literally written.
  - **Purchase orders assume one currency for all lines**, same simplification as Sprint 3's sale-currency rule.
  - **No void/cancel flow for a submitted purchase order** — once created it can only be received, not cancelled. A reasonable scope cut given the sprint's size; add it if real usage needs it.
  - **Refund proportional-tender-split gap from Sprint 3 is unchanged** — still a single refund tender type, not carried forward here.
- Blockers requiring a human/provider decision: Paynow sandbox credentials (owner explicitly deferred this sprint — same pattern as Africa's Talking in Sprint 1). GoTrue SMS hook and the offline-refresh E2E gap (Sprint 3) remain exactly as previously documented, untouched this sprint.

## Next assistant

- Next permitted sprint: Sprint 5 (Reports, Exports & Fiscal-Ready Records) — but Paynow sandbox verification, if credentials become available, should probably happen before or alongside it rather than being deferred indefinitely.
- First files to read: this file, `lib/integrations/paynow.ts` (file header specifically), `lib/db/migrations/0010-0015*.sql`, `tests/integration/customers-suppliers.test.ts`.
- Do not do yet: fiscal export claims, WhatsApp/SMS notifications, multi-branch — all later sprints. Do not claim the Paynow integration "works" without a real sandbox run first.
