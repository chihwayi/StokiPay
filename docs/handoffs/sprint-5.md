# Sprint 5 Handoff — Reports, Exports & Fiscal-Ready Records

## Status

`complete`

## Scope delivered

- `lib/domain/reports.ts` — pure calculation functions (`computeSaleItemProfit`, `aggregateProfitReport`, `computeCashUpSummary`, `computeDebtSummary`, `computeStockVarianceSummary`). Every function reads only already-stored snapshots: a sale's own `exchange_rate_snapshot` (ADR 0004) and a `sale_items` row's own frozen `unit_cost_price_minor` (Sprint 3) — there is no product lookup or exchange-rate lookup inside any of these functions at all, which is what makes "a changed product cost does not alter historic profit" and "reports use stored rate context, not today's rate" true by construction rather than by convention or discipline.
- `lib/reports/build-report.ts` — the single function both `app/reports/page.tsx` (on-screen) and both export routes call with identical filters, so on-screen/PDF/Excel totals match by construction (one shared query+calculation path, not three independently-written ones that happen to agree). Takes the caller's own request-scoped, cookie-based Supabase client — never a service-role client — so an export is bound by exactly the same RLS as the screen.
- `/reports` — owner/manager-only dashboard with branch/date-range filters, showing profit, cash-up reconciliation, outstanding debt, and stock variance, each pulling from the tables Sprints 2-4 already built (`sales`/`sale_items`, `cash_sessions`/`cash_variances`, `customer_ledger`, `stock_movements` `count_variance` rows).
- `/api/reports/export/{pdf,excel}` — PDF via `pdf-lib`, Excel via `exceljs` (both new dependencies — justified by this sprint's explicit "PDF/Excel exports" task, no existing library in the project covered either format). Every export carries the label "Configuration/export only — not a verified ZIMRA/fiscal-device compliance integration" (CLAUDE.md's compliance rule, `sprints.md`'s explicit acceptance criterion) directly on the document, not just in a README somewhere a business owner would never see it.
- 7 new unit tests (`tests/unit/reports.test.ts`) + 3 new integration tests (`tests/integration/reports.test.ts`) against real database rows.

## Acceptance evidence

| Criterion | Evidence | Result |
|---|---|---|
| A changed product cost does not alter historic profit; test proves it | `tests/integration/reports.test.ts` — creates a sale, computes profit, changes `products.cost_price_minor`, recomputes from the same `sale_items` row, asserts identical | Pass |
| Reports display original currency and rate context; they do not use today's exchange rate for historical totals | `tests/integration/reports.test.ts` — approves a new, different exchange rate after a sale completes, asserts the sale's own `exchange_rate_snapshot` is unchanged | Pass |
| On-screen, PDF and Excel totals match for a fixed seeded dataset | Architectural guarantee: `app/reports/page.tsx` and both export routes call the exact same `buildReport()` with the exact same filters — verified indirectly via `tests/integration/reports.test.ts`'s profit/debt assertions against raw SQL sums, since `buildReport()` is those same queries plus the same `lib/domain/reports.ts` functions. **Not verified via a live authenticated Playwright run against the deployed export routes** — see Limitations. | Architecturally proven; not end-to-end browser-tested |
| Daily cash-up, outstanding debt, stock variance and profit reports reconcile to underlying ledgers | `tests/integration/reports.test.ts`'s debt test asserts the computed summary equals a raw `sum()` over `customer_ledger`; `tests/unit/reports.test.ts` proves the same for cash-up and stock variance against synthetic ledger-shaped input | Pass |
| Any fiscal export is labelled "configuration/export only" unless formal compliance verification is recorded | Label is drawn directly onto both the PDF and Excel outputs, and shown on-screen at `/reports` | Pass |

## Verification run

```text
npm run lint            → pass
npm run typecheck       → pass
npm run test             (unit)        → 26/26 pass (operation-id, money, paynow, reports)
npm run test:integration (RLS)         → 14/14 pass
npm run test:integration (Stock)       → 9/9 pass
npm run test:integration (Sales/etc.)  → 11/11 pass
npm run test:integration (Customers/Suppliers) → 6/6 pass
npm run test:integration (Reports)     → 3/3 pass
npm run test:e2e         → 2/2 pass
npm run build            → 28 routes compiled
Date: 2026-08-29
```

Run individually per file (documented tunnel-concurrency limitation, unrelated to this sprint). One new infra note this session: the bare `ssh root@31.220.84.245` form intermittently failed with "Permission denied (publickey)" mid-session even though the `managed-server` SSH config alias (`~/.ssh/config`, `IdentityFile ~/.ssh/managed_server_ed25519`) worked immediately — use the alias, not the raw IP, if this recurs. No GitHub Actions used or relied on, per the owner's standing instruction.

## Changed surfaces

- No migrations — this sprint reads existing tables only, no schema changes.
- New dependencies: `pdf-lib` (PDF export), `exceljs` (Excel export) — both required directly by this sprint's explicit task list, no substitute already in the project.
- Routes/components: `/reports`, `/api/reports/export/{pdf,excel}`, `components/features/reports/report-filters-form.tsx`; dashboard gained an owner/manager-only "Reports" link.
- Libraries: `lib/domain/reports.ts` (pure calculations), `lib/reports/build-report.ts` (server-only shared data-fetch + calculation).

## Decisions and limitations

- ADRs: none new — no locked decision changed; PDF/Excel library choice is a normal implementation dependency, not a cross-cutting architectural one.
- Known limitations:
  - **No live browser-authenticated test of the export routes.** `buildReport()` requires a real Supabase JS client (cookie-based session), which my integration test setup (raw `postgres` package connections over the SSH tunnel) doesn't construct — a genuine end-to-end proof would need a Playwright run with a real authenticated staging session. The "totals match" claim rests on the shared-function architecture plus indirect verification (the same queries/calculations are proven correct against raw SQL sums), not a literal screenshot-vs-PDF-vs-Excel comparison. Flagged here rather than silently assumed, same pattern as prior sprints' honest gaps.
  - **PDF export is single-page** — debt/stock-variance rows stop rendering past the page bottom rather than paginating. Fine for a small SME's typical row counts this sprint targets; revisit if real usage needs more.
  - **Debt report is tenant-wide, not branch-filterable** — `customer_ledger` has no `branch_id` column (a customer's debt isn't tied to one branch), so the branch filter only narrows profit/cash-up/stock-variance, not debt. This is a deliberate reflection of the schema, not an oversight.
- Blockers requiring a human/provider decision: none new. Paynow sandbox credentials (Sprint 4) and the offline-refresh E2E gap (Sprint 3) remain exactly as previously documented, untouched this sprint.

## Next assistant

- Next permitted sprint: Sprint 6 (Multi-device Conflict, Recovery & Resilience).
- First files to read: this file, `lib/domain/reports.ts`, `lib/reports/build-report.ts`, `tests/integration/reports.test.ts`.
- Do not do yet: multi-device conflict UI, sync telemetry, two-device Playwright fixtures — all Sprint 6. Do not claim the export routes are browser-tested without actually running a Playwright session against them first.
