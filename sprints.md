# StockFlow ZW — Modular, Verifiable Delivery Plan

> Companion to `project_description.md`. This is the execution contract. A sprint is complete only when its automated verification, manual evidence, documentation, and handoff are present. Do not start a later sprint on an unverified predecessor.

## How any AI assistant must use this plan

1. Read `project_description.md`, this file, `README.md`, `docs/architecture.md`, `docs/runbooks/coolify-deployment.md`, and the latest `docs/handoffs/` note before changing code.
2. Work only on the named sprint. Do not silently implement work assigned to later sprints.
3. Create or update the sprint's tests at the same time as its implementation. A checkbox without evidence is not complete.
4. Run the listed verification commands. Record the actual commands and outcome in `docs/handoffs/sprint-<n>.md`.
5. Update the sprint's checkboxes only after verification passes. If blocked by credentials, a provider, or a human decision, record the blocker; do not pretend completion.
6. Preserve the cross-sprint invariants below. A new table requires a migration, RLS, test data, and an authorization test in the same sprint.

### Required handoff note

Each completed sprint adds `docs/handoffs/sprint-<n>.md` containing: scope delivered; migrations and environment variables added; routes/components/services changed; verification commands and results; known limitations; open decisions; and the exact next sprint. This is the source of truth for the next assistant.

### Standard verification gate

Every sprint must pass the repository equivalents of:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

If a command is not available yet, the sprint must add it or explicitly document why it cannot run. Provider-dependent checks use sandbox credentials and must be labelled separately from automated checks.

## Locked delivery decisions

- Launch verticals: general retail and bottle store. Pharmacy, hardware and salon remain extension modules.
- Currency: ZiG, USD and ZAR; legacy ZWL may be imported/displayed historically. A transaction stores original amount/currency, rate snapshot, source, approval and reporting value.
- Sync: PowerSync is the single selected local-first sync engine. No second sync engine or custom parallel outbox without an explicit architecture decision record (ADR).
- Hosting/data platform: self-hosted on our own Coolify instance (Contabo server) — Next.js app plus a self-hosted Supabase stack (Postgres/GoTrue/PostgREST/Storage/Realtime) as separate Coolify resources, not Vercel/managed Supabase Cloud. See `docs/adr/0001-self-hosted-coolify-data-platform.md`.
- Core launch flow: product → stock receipt/count → offline-safe sale → cash-up → debt/payment → report.
- Compliance: build exportable, configurable fiscal records first. Do not claim ZIMRA/fiscal-device compliance until a Zimbabwe compliance professional validates the current requirement and an integration is tested.

## Cross-sprint invariants

1. Money, stock, refunds, credit and cash-up figures are reconstructable from immutable movements/ledger entries.
2. A sale, return, payment or stock change uses an idempotency key and is atomic; replaying it never duplicates business data.
3. Every tenant-owned table has `tenant_id`, RLS policies, and an automated cross-tenant denial test.
4. Completed financial records are reversed by linked records, never edited or deleted.
5. Every core stock/POS write uses the local-first path from its first implementation—not a later retrofit.
6. Payment webhooks are signature-verified, idempotent and reconciled with polling/query fallback.
7. AI is read-only/additive, tenant-scoped, reviewable and never blocks a core workflow.

---

## Sprint 0 — Discovery, Foundation & Offline Contract

**Goal:** Establish an executable project and lock the decisions that cannot safely be retrofitted.

**Tasks:** interview 10–15 target users; record payment, cash-up, currency and connectivity findings; scaffold Next.js/TypeScript/Tailwind/Drizzle against a self-hosted Supabase stack on Coolify (see ADR 0001); configure CI, Coolify-based staging, Sentry and PostHog; add `.env.example`; write ADRs for PowerSync, event/idempotency format and currency snapshots; add a PWA shell and visible sync-state component.

**Acceptance evidence:**

- [ ] `docs/discovery.md` identifies launch users, validated pains, pricing hypotheses and unresolved risks.
- [ ] `docs/adr/` contains the sync, idempotency and currency decisions.
- [ ] A fresh clone can run locally using README instructions and `.env.example`.
- [ ] CI runs lint, typecheck, unit test, E2E smoke test and production build.
- [ ] Staging shows the installable PWA shell and sync status.

**Exit gate:** standard verification passes; staging URL and discovery/ADR links are in the handoff note.

## Sprint 1 — Identity, Tenants & Authorisation

**Goal:** An owner signs in by phone OTP, creates a business/branch, and is protected by database-level isolation.

**Tasks:** phone OTP; `tenants`, `branches`, `staff_users`, `devices`, `audit_log`; owner/manager/cashier permissions; onboarding and settings; RLS migrations; seeded two-tenant test fixtures.

**Acceptance evidence:**

- [ ] A new user reaches an empty dashboard in under 60 seconds in a recorded E2E test.
- [ ] Tenant A cannot select, insert, update or delete Tenant B rows; integration tests prove each case.
- [ ] A cashier cannot manage staff, branches, rates or product deletion; tests prove API and UI denial.
- [ ] Device registration provides a stable device ID used by future offline operations.

**Exit gate:** standard verification plus RLS integration suite passes against a real self-hosted Postgres/Supabase test database on Coolify.

## Sprint 2 — Product, Stock & Inventory Controls

**Goal:** A business can create products, receive stock, count stock, and investigate every variance.

**Tasks:** `products`, `stock_movements`, derived `stock_levels`, stock receipts, blind counts, reason-coded adjustments, low-stock alerts, price lists, rate approval role, barcode fields; local-first write adapters from day one.

**Acceptance evidence:**

- [ ] Every stock change appends an immutable movement with actor, device, idempotency key and reason where applicable.
- [ ] A reconciliation test proves stock level equals the sum of movements for seeded products.
- [ ] Blind count shows no expected quantity to the counting staff member and produces an approval-required variance.
- [ ] A user without the rate role cannot alter a rate or rate-derived price.
- [ ] Offline stock receipt/adjustment queues locally and syncs exactly once when reconnected.

**Exit gate:** standard verification plus an offline E2E stock test and reconciliation test pass.

## Sprint 3 — Offline-Safe POS, Returns & Cash-up

**Goal:** A cashier can complete and reverse a sale offline, then close a till with a defensible variance record.

**Tasks:** `sales`, `sale_items`, `payments`, `cash_sessions`, `cash_counts`, `cash_variances`, `returns`; barcode/manual POS, split tender, ZiG/USD/ZAR snapshots, receipt, return/refund/void controls, opening float and closing cash-up; all writes through PowerSync/local storage.

**Acceptance evidence:**

- [x] A three-line split cash/mobile-money sale atomically creates sale, lines, payment and stock movements; forced failure leaves no partial server record. (`tests/integration/sales.test.ts`)
- [x] Replaying the same operation ID creates one sale only. (`tests/integration/sales.test.ts`)
- [ ] An offline sale survives browser refresh, synchronizes once after reconnect, and has the same receipt/stock result as an online sale. Local-first write path and idempotent upload are implemented and integration-tested at the RPC layer; no automated browser-level offline-refresh E2E test exists yet — see `docs/handoffs/sprint-3.md` limitations.
- [x] A return creates linked reversal records and never mutates the original completed sale. (`tests/integration/sales.test.ts`)
- [x] Cash-up compares expected and counted amounts by tender/currency; over/short requires a reason and manager review when above the configured threshold. (`tests/integration/sales.test.ts`)

**Exit gate:** standard verification plus atomicity, replay, return and cash-up tests pass. Offline-refresh E2E test is outstanding — see `docs/handoffs/sprint-3.md`.

## Sprint 4 — Customers, Suppliers, Credit & Mobile-Money Reconciliation

**Goal:** The business knows exactly who owes it, what it owes suppliers, and which mobile-money payments are truly confirmed.

**Tasks:** customers, suppliers, immutable ledgers, credit sale/partial repayment, purchase orders/receiving discrepancies/landed costs; Paynow sandbox request, signed webhook, poll fallback and reconciliation state machine.

**Acceptance evidence:**

- [ ] Customer and supplier balances are reconstructable from ledger entries in a unit/integration test.
- [ ] Credit sale reduces stock immediately and creates the appropriate unpaid ledger balance.
- [ ] Partial repayment updates the balance without editing historical entries.
- [ ] Sandbox payment completes request → verified webhook or poll → reconciled payment; duplicate webhook changes nothing.
- [ ] Invalid webhook signature is rejected and audited.

**Exit gate:** standard verification plus Paynow sandbox evidence and webhook idempotency tests pass.

## Sprint 5 — Reports, Exports & Fiscal-Ready Records

**Goal:** An owner can trust daily performance, debt, inventory and cash-up reports.

**Tasks:** historical COGS/profit engine, owner dashboard, branch/date/currency filters, report conversion using stored snapshots, PDF/Excel exports, configurable invoice/fiscal export fields; explicitly label compliance status.

**Acceptance evidence:**

- [ ] A changed product cost does not alter historic profit; test proves it.
- [ ] Reports display original currency and rate context; they do not use today's exchange rate for historical totals.
- [ ] On-screen, PDF and Excel totals match for a fixed seeded dataset.
- [ ] Daily cash-up, outstanding debt, stock variance and profit reports reconcile to underlying ledgers.
- [ ] Any fiscal export is labelled “configuration/export only” unless formal compliance verification is recorded.

**Exit gate:** standard verification plus snapshot report fixtures and export comparison pass.

## Sprint 6 — Multi-device Conflict, Recovery & Resilience

**Goal:** The system stays truthful through load-shedding, two-device activity and failed syncs.

**Tasks:** conflict-review queue, owner resolution UI, sync telemetry, retry/recovery policies, retained-operation cleanup rules, two-device Playwright fixtures, slow-3G and network-loss scenarios.

**Acceptance evidence:**

- [ ] Two offline devices selling the last item create a visible owner-review conflict; no silent negative stock occurs.
- [ ] A network cut mid-operation results in either one complete operation or none, never an inconsistent partial state.
- [ ] Sync status accurately presents offline, queued, syncing, failed and synced states.
- [ ] A scripted full day offline scenario syncs all valid operations exactly once on reconnect.
- [ ] Sync failures and conflicts are captured in monitoring with tenant-safe identifiers.

**Exit gate:** standard verification plus two-device offline and recovery suites pass.

## Sprint 7 — AI-Assisted Onboarding & Read-only Copilot

**Goal:** AI reduces setup effort without creating unreviewed or cross-tenant data risk.

**Tasks:** ledger-photo extraction into editable drafts, confirmation/import workflow, read-only tenant-scoped analytical tools, citations to source figures, anomaly job and dismissible alerts; rate/cost confidence and safe fallbacks.

**Acceptance evidence:**

- [ ] OCR output is always a draft; no product or stock record is created until an owner confirms it.
- [ ] A fixed evaluation set of handwritten samples has documented extraction quality and correction rate.
- [ ] Copilot answers required profit, best/worst seller and debt questions using returned tenant-scoped figures with cited period/source.
- [ ] Adversarial tests demonstrate the copilot cannot access another tenant or issue writes.
- [ ] AI outage leaves manual onboarding and all POS/stock flows usable.

**Exit gate:** standard verification plus AI evaluation report and tenant-isolation adversarial test pass.

## Sprint 8 — WhatsApp, SMS & Notifications

**Goal:** Owners receive useful alerts and receipts through the channels they already use.

**Tasks:** WhatsApp webhook/client, templates, receipt and low-stock/debt alerts, notification preferences, SMS fallback; structured bot commands only after staff identity/branch authorization is resolved.

**Acceptance evidence:**

- [ ] A test WhatsApp receipt and low-stock alert are delivered from sandbox/test configuration.
- [ ] Inbound webhook signature and replay protection are tested.
- [ ] A structured authorised “log sale” command reaches the same idempotent transaction path as the POS.
- [ ] Unauthorised numbers and ambiguous commands create no sale and receive a safe response.
- [ ] SMS fallback works for outgoing alerts with opt-in/opt-out preference recorded.

**Exit gate:** standard verification plus provider sandbox transcript/screenshots and security tests pass.

## Sprint 9 — Multi-branch, Localisation & Performance

**Goal:** A growing business can operate multiple branches, staff and languages comfortably on low-end Android devices.

**Tasks:** aggregate/per-branch views, branch-scoped permissions, English/Shona/Ndebele string catalogues, accessibility remediation, performance budgets and low-data asset handling.

**Acceptance evidence:**

- [ ] Two seeded branches show correct aggregate and branch-only reporting with authorization tests.
- [ ] No production UI strings are hard-coded outside the locale catalogues; automated check enforces this where practical.
- [ ] Core POS/onboarding routes work in English, Shona and Ndebele with no missing keys.
- [ ] Core mobile routes meet the recorded performance budget under throttled 3G/low-end-device simulation.
- [ ] Keyboard, touch target and contrast checks pass on POS and cash-up flows.

**Exit gate:** standard verification plus locale, permission and performance reports pass.

## Sprint 10 — Billing, Beta & Launch Decision

**Goal:** Make a measured, reversible decision to launch after real businesses prove reliability.

**Tasks:** server-enforced Free/Growth/Pro capabilities, billing/renewal flow, full security review, backup/restore drill, load test, beta recruitment/runbook, support and incident process.

**Acceptance evidence:**

- [ ] A Free tenant cannot invoke Growth/Pro capability through UI or direct API.
- [ ] Backup restoration is rehearsed into an isolated environment and reconciliation results are recorded.
- [ ] Full-schema RLS test suite passes; no critical/high unresolved security finding remains.
- [ ] At least five Zimbabwean SMEs complete one real week; no data-loss incident occurs.
- [ ] Beta feedback, defects, launch metrics baseline and go/no-go decision are documented.

**Exit gate:** standard verification, load/security/restore evidence, and signed launch checklist are present.

## Post-launch modules (not launch blockers)

- Pharmacy batch/expiry and regulated workflow module.
- Hardware landed-cost/catalogue module.
- Salon services, bookings and staff commissions module.
- Loyalty, group buying, lender integrations and native Android wrapper.
