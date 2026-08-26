# StockFlow ZW — SME Stock, Sales & Business Management Platform

> A cloud-based, offline-first, multi-tenant SaaS built for Zimbabwean (and broader African) SMEs still running their business on exercise books, Excel, WhatsApp, and paper invoices.

---

## 1. Executive Summary

**StockFlow ZW** replaces the exercise book, the Excel sheet, and the WhatsApp order group with one simple, cloud-based system that any SME owner can run from their phone: Products → Stock → Sales → Customers → Payments → Profit Reports.

The core workflow is not novel — it's proven demand (multiple local competitors already exist: EllzTech, Vizion Technologies, Smart POS Software, Matiyas ERP). What will make StockFlow ZW win is **execution on the things Zimbabwean SMEs actually struggle with**, which most competitors handle poorly or not at all:

1. **Offline-first, not offline-tolerant** — the app must work fully with zero connectivity during load-shedding/no-data periods, then sync automatically.
2. **Mobile money (EcoCash/OneMoney) baked into payments**, not bolted on.
3. **WhatsApp as an interface**, not just a competitor to replace — owners get daily summaries, low-stock alerts, and can even log a sale by sending a WhatsApp message.
4. **AI-powered onboarding** — snap a photo of a handwritten stock book or exercise book page, and the AI digitizes it into products/stock automatically. This collapses the single biggest barrier to switching: manual data entry.
5. **Multi-currency by default** (ZiG / USD / ZAR, with legacy ZWL history where needed) with controlled exchange-rate snapshots, because every Zimbabwean SME already deals with this daily.
6. **Vertical-flavoured onboarding** — the same core engine, but tailored setup flows/reports for retail shops, bottle stores, pharmacies, hardware shops, and salons, so it never feels like generic foreign software.

---

## 2. Problem Statement & Market Context

Thousands of Zimbabwean SMEs track stock and sales using exercise books, WhatsApp groups, paper invoices, or unstructured Excel sheets. This causes:

- Lost sales from stockouts nobody saw coming
- Theft/shrinkage that's invisible without a stock trail
- No real picture of profit (revenue tracked, cost of goods rarely is)
- No customer or credit/debt history ("who owes me what")
- Owners unable to check on the business remotely (they *are* the business, physically, all day)

**Existing local competitors** (as of research): EllzTech (custom POS/inventory builds), Vizion Technologies (custom SME software, free-prototype sales model), Smart POS Software (one-time-fee, no subscription), and ERP-tier products like Matiyas / ERPNext-based systems aimed at larger, ZIMRA-compliant multi-currency businesses.

**Implication:** the core CRUD (products/stock/sales/customers/payments/reports) is table stakes, not a differentiator. StockFlow ZW's edge has to come from offline resilience, mobile-money-native payments, AI-assisted onboarding, cash-up accountability, and a pricing model that matches how these businesses actually earn and spend (irregular multi-currency cash flow, subscription-averse).

---

## 3. Target Users / Personas

| Persona | Business type | Pain point | What they need most |
|---|---|---|---|
| **Tendai** | Owns a small grocery/tuck shop | Doesn't know what's actually selling or making money | Simple daily sales + profit view on phone |
| **Mai Chipo** | Runs a hardware/building supplies shop | Stock theft, no reorder visibility | Stock alerts, supplier tracking, staff accountability |
| **Farai** | Bottle store owner, 2 branches | Can't see both branches without visiting | Multi-branch dashboard, remote visibility |
| **Rudo** | Pharmacy assistant/manager | Needs fast, accurate billing + expiry tracking | Fast POS, batch/expiry tracking |
| **Blessing** | Informal trader / flea market vendor | Can't afford or justify "real" software | Ultra-cheap/free tier, WhatsApp-based logging |

---

## 4. Vision & "Wow" Differentiators

These are the features that should make this feel like a genuinely modern, best-in-class product rather than another generic POS clone:

### 🔥 Tier 1 — Core differentiators (build these to actually win)
- **AI Ledger Digitization (OCR onboarding)** — owner photographs their exercise book / stock sheet; a vision-capable LLM extracts product names, quantities, and prices and pre-populates the system. Turns a 3-hour onboarding chore into a 3-minute photo.
- **True offline-first architecture** — local-first database (IndexedDB) with background sync and conflict resolution, so sales/stock entries work with zero internet and sync when connectivity returns. This is the single biggest technical moat vs. competitors.
- **EcoCash / OneMoney / Paynow-native payments** — record and reconcile mobile money payments automatically instead of manual entry; support USSD-initiated payment requests to customers.
- **WhatsApp Business bot interface** — owners/staff can log a sale, check today's takings, or get a low-stock alert entirely inside WhatsApp, no app-switching required.
- **AI Business Copilot** — a natural-language chat ("How much profit did I make last week?" / "What's my slowest-moving product?") answered from the tenant's real data, plus proactive anomaly alerts ("Bread sales down 40% this week vs. last month").

### ✨ Tier 2 — Strong "wow" polish features
- **Multi-currency ledger** (ZiG/USD/ZAR, plus legacy ZWL) with an approved rate snapshot per transaction and transparent report conversion.
- **Barcode scanning via phone camera** — no extra hardware needed.
- **Cash-up and till reconciliation** — opening float, expected versus counted cash/mobile money, over/short reasons and manager approval.
- **Stock counts and variance approval** — blind staff counts, discrepancy reports and immutable reason-coded adjustments to expose shrinkage.
- **Returns, refunds and manager overrides** — linked reversal records, never edits to completed sales.
- **Price-list and exchange-rate controls** — prices may be fixed in USD or rate-derived; only approved users can change rates or reprice products.
- **Supplier credit & debt tracking** — who you owe, who owes you, with automated WhatsApp/SMS payment reminders.
- **Purchase orders and landed cost** — receiving discrepancies and fair allocation of freight/duty into product cost.
- **Multi-branch / multi-till support** with role-based staff permissions (cashier vs. owner vs. manager).
- **Real-time collaborative dashboard** — if two staff are using tills at once, stock updates live across devices.
- **Voice-to-entry** — speak a sale or stock update instead of typing (great for busy tills).
- **SMS fallback mode** for feature-phone customers/staff without smartphones — log a sale via SMS shortcode.
- **Beautiful, exportable reports** — PDF/Excel profit reports, tax-ready summaries.
- **Vertical templates** — one-click setup packs for retail, bottle store, pharmacy (expiry/batch fields), hardware, salon (services + bookings).

### 🌍 Tier 3 — Growth / network-effect features (v2+)
- **Group buying network** — small shops pool orders to a shared supplier for bulk pricing.
- **Customer loyalty & digital receipts** sent via WhatsApp.
- **Embedded micro-lending signal** — clean sales/profit history becomes a credit score SMEs can use with microfinance partners (huge future monetization lever).

---

## 5. Product Architecture

### 5.1 SaaS Model: **Multi-tenant, shared database, row-level isolation**
- One codebase, one database, every table carries a `tenant_id` (= business/shop).
- Enforce isolation at the **database layer** via Postgres Row-Level Security (RLS) — not just application logic — so a bug in app code can never leak data across tenants.
- Each tenant can have multiple **branches**, multiple **staff users** with roles (`owner`, `manager`, `cashier`), and multiple **tills/devices**.
- This model is the right call here: cheapest to run, easiest to update for all tenants at once, and scales to thousands of small SMEs without per-tenant infrastructure overhead. Only consider schema-per-tenant later if a handful of large enterprise clients demand hard data isolation.

### 5.2 Client Architecture: **Offline-first Progressive Web App (PWA)**
- No app store required — installs straight from the browser to the home screen, works on cheap Android phones.
- Local-first data layer: every write goes to local storage first (instant, works offline), then syncs to the server in the background.
- This avoids the two big traps: (a) forcing a native app store install on users with limited data, and (b) an app that's useless the moment load-shedding kills the WiFi.
- Every offline write has a device ID and idempotency key; reconnecting can never create a duplicate sale or stock movement.

### 5.3 High-Level Data Flow

```
Owner/Staff Device (PWA)
   ↓ (local-first write, instant)
IndexedDB (local cache + outbox queue)
   ↓ (background sync when online)
Sync Engine (conflict resolution)
   ↓
PostgreSQL (multi-tenant, RLS-enforced) — self-hosted Supabase stack on Coolify
   ↓
Realtime channel → other devices for that tenant update live
   ↓
Reports / AI Copilot / WhatsApp bot read from same source of truth
```

---

## 6. Tech Stack (current, modern, 2026-appropriate)

| Layer | Technology | Why |
|---|---|---|
| **Frontend framework** | Current supported Next.js (App Router) + React + TypeScript | Server components for fast loads on cheap phones/data, one codebase for web + PWA |
| **UI / styling** | Tailwind CSS + shadcn/ui + Radix primitives | Fast, accessible, easy to theme per vertical |
| **PWA / offline** | Workbox (service worker) + Dexie.js (IndexedDB wrapper) | Reliable offline caching and local-first data store |
| **Local-first sync engine** | PowerSync (Postgres-backed sync) | Make one supported choice early; it provides the local-first sync foundation without hand-rolling the risky parts |
| **Backend** | Next.js Server Actions / Route Handlers + tRPC (typed API) | End-to-end type safety, fast iteration for Claude Code to scaffold |
| **Database** | PostgreSQL via a **self-hosted Supabase stack** (Postgres + GoTrue + PostgREST + Realtime + Storage) on our own Coolify server | Multi-tenant RLS built in, realtime subscriptions, no recurring managed-cloud fee, full control on infrastructure we already operate — see ADR 0001 |
| **Auth** | Self-hosted GoTrue (Supabase's auth service) — **phone number + OTP** as primary login (not email) | Matches how SME owners actually identify themselves; email adoption is low in this segment |
| **AI / OCR / Copilot** | Anthropic Claude API (vision + text) — receipt/ledger OCR, natural-language business Q&A, anomaly detection | Best-in-class vision + reasoning for messy handwritten stock books and conversational reporting |
| **WhatsApp integration** | WhatsApp Business Cloud API (Meta) | Official, reliable channel for bot commands, alerts, digital receipts |
| **Payments / mobile money** | Paynow (Zimbabwean aggregator: EcoCash, OneMoney, Visa/Mastercard) | Single integration covers the dominant local payment rails |
| **SMS fallback** | Africa's Talking or Twilio | Reaches feature-phone users without data |
| **Charts / reporting UI** | Tremor or Recharts | Clean, fast dashboards; PDF export via `@react-pdf/renderer` |
| **Barcode scanning** | `html5-qrcode` (browser camera) | No extra hardware required |
| **Background jobs** | Self-hosted job runner (e.g. Trigger.dev self-hosted, or a scheduled worker service on Coolify) | Scheduled reports, exchange-rate refresh, WhatsApp reminders |
| **Exchange rates** | Provider feed + owner/manager approval workflow | Rates are time-versioned, sourced and approved; reports use the transaction snapshot, never today's rate |
| **Hosting / infra** | Self-hosted on our own Coolify instance (Contabo server) — Next.js app + self-hosted Supabase stack as separate Coolify resources | Owner-operated infrastructure already paid for and in production use for other projects; no recurring Vercel/Supabase Cloud subscription — see ADR 0001 |
| **CI/CD** | GitHub Actions | Automated test + deploy pipeline |
| **Monitoring** | Sentry (errors) + PostHog (product analytics) | Understand real-world usage and failure patterns, especially offline-sync edge cases |
| **Testing** | Vitest (unit) + Playwright (E2E, incl. offline-mode simulation) | Offline sync correctness is the highest-risk area — must be tested explicitly |

---

## 7. Core Feature Set (MVP)

1. **Auth & Onboarding**: phone/OTP signup, business profile, vertical template selection (retail/bottle store/pharmacy/hardware/salon/general), optional AI photo-based ledger import.
2. **Products**: name, category, cost price, sell price, unit, barcode, photo, low-stock threshold.
3. **Stock**: stock-in (purchases/receiving), stock adjustments (damage/loss), multi-branch stock levels, low-stock alerts.
4. **Sales / POS**: fast till screen, barcode/manual add, discounts, multi-currency tender (ZiG/USD/ZAR + mobile money), digital receipt, returns/voids as linked reversals.
5. **Customers**: customer profiles, purchase history, credit/debt (accounts receivable) with reminders.
6. **Suppliers**: supplier profiles, purchase orders, accounts payable, debt tracking.
7. **Payments**: cash, EcoCash/OneMoney (Paynow), bank transfer, credit — all reconciled against sales.
8. **Profit & Reports**: daily/weekly/monthly profit (revenue − COGS − adjustments), best/worst sellers, exportable PDF/Excel, multi-currency normalized view.
9. **Staff & Roles**: owner/manager/cashier permissions, per-till activity log (accountability against theft).
10. **Cash-up & Dashboard**: opening/closing till reconciliation, today's sales, stock alerts, outstanding debts, at-a-glance profit — mobile-first.

## 8. "Wow" Feature Set (post-MVP fast-follow)

11. AI ledger photo import (OCR onboarding)
12. WhatsApp bot (log sale, check takings, receive alerts, send receipts)
13. AI Business Copilot (natural-language Q&A + proactive anomaly alerts)
14. Voice-to-entry for sales/stock
15. SMS fallback logging
16. Multi-branch real-time sync
17. Vertical-specific fields (expiry/batch for pharmacy, service+booking for salons)
18. Group-buying / supplier network (v2)

---

## 9. High-Level Data Model

```
tenants (businesses)
  ├── branches
  ├── staff_users (role: owner/manager/cashier)
  ├── products (belongs to tenant)
  │     └── stock_levels (per branch)
  ├── stock_movements (in/out/adjustment, audit trail)
  ├── customers
  │     └── customer_ledger (credit/debt entries)
  ├── suppliers
  │     └── supplier_ledger (payables)
  ├── sales
  │     ├── sale_items (line items → product, qty, price)
  │     └── payments (method: cash/ecocash/onemoney/bank/credit)
  ├── tills / cash_sessions / cash_counts / cash_variances
  ├── price_lists / exchange_rates (versioned, source + approver)
  ├── returns / refunds / manager_overrides (linked reversal records)
  ├── sync_operations / conflict_reviews (device ID + idempotency)
  ├── exchange_rates (transaction snapshot per currency pair)
  └── audit_log (who did what, when — theft accountability)
```

Every table above carries `tenant_id`; Postgres RLS policies restrict all reads/writes to `auth.uid()`'s tenant and role.

---

## 10. Non-Functional Requirements

- **Offline resilience**: core sales/stock flows must work fully offline with graceful sync and conflict resolution (last-write-wins with an audit trail, escalate true conflicts to the owner for manual review).
- **Low-data-usage mode**: minimal payload sizes, image compression, works usably on 2G/3G.
- **Multi-currency correctness**: every monetary value stores its original currency, rate snapshot, source/approval and reporting value. Reports never silently apply today's rate to history.
- **Security**: RLS-enforced tenant isolation, encryption at rest on the self-hosted volume and in transit via HTTPS, role-based access control, audit log for all stock/financial changes, verified webhook signatures and idempotent provider handling.
- **Performance**: sub-1s till screen response even on low-end Android devices.
- **Localization**: English + Shona + Ndebele UI strings from day one (config-driven, not hardcoded).
- **Accessibility**: large tap targets, readable fonts, works well one-handed on a phone at a busy till.

---

## 11. Pricing / Monetization Model

Given local aversion to recurring USD subscriptions and irregular cash flow:

- **Free tier**: single branch, 1 staff user, core sales/stock/cash-up/reports, WhatsApp receipts — this is the wedge for informal traders (Blessing persona).
- **Growth tier (low monthly fee, payable via EcoCash)**: multi-branch, multi-staff, AI Copilot, WhatsApp bot, SMS fallback.
- **Pro tier**: unlimited branches/staff, priority support, supplier network access, advanced analytics/export.
- Consider a **one-time setup + cheap ongoing cloud fee** hybrid, echoing the "pay once, own it" pattern that resonates locally, with the recurring fee framed clearly as "cloud backup & sync," not a vague subscription.

---

## 12. Suggested Build Roadmap (for Claude Code to plan sprints against)

> Each sprint assumes ~1 week. Adjust to team velocity. Order is deliberate: get a usable, sellable single-tenant MVP fast, then layer in multi-tenancy hardening and wow features.

**Sprint 0 — Discovery, Foundation & Offline Contract**
Validate launch users and payment/compliance assumptions; set up the repo, CI and staging environment; lock the chosen sync engine, event/idempotency contract and design system before business features.

**Sprint 1 — Auth & Tenants**
Phone/OTP auth, tenant + branch + staff_user schema, RLS policies, role-based access, onboarding flow (business profile + vertical template picker).

**Sprint 2 — Products & Stock**
Product CRUD, categories, stock-in/adjustments, stock_movements audit trail, low-stock thresholds, barcode field.

**Sprint 3 — Offline-Safe Sales / POS & Cash-up**
Till UI, cart, barcode scan, multi-currency tender, atomic sale events, receipts and cash-session reconciliation, all through the local-first write path.

**Sprint 4 — Customers, Suppliers & Payments**
Customer/supplier CRUD, credit/debt ledgers, Paynow (EcoCash/OneMoney) integration, payment reconciliation.

**Sprint 5 — Reports & Dashboard**
Profit calculation engine (COGS-aware), daily/weekly/monthly reports, PDF/Excel export, owner dashboard.

**Sprint 6 — Offline Conflict, Recovery & Resilience Hardening**
Complete multi-device conflict review, recovery, sync observability and load-shedding E2E testing. Offline capability starts in Sprint 0 and is used by every stock/POS write before this sprint.

**Sprint 7 — AI Features**
Claude API integration: photo-based ledger OCR onboarding, natural-language Business Copilot, anomaly detection alerts.

**Sprint 8 — WhatsApp & SMS**
WhatsApp Business Cloud API bot (log sale, check takings, alerts, receipts), SMS fallback via Africa's Talking.

**Sprint 9 — Multi-Branch, Roles & Polish**
Multi-branch real-time dashboard, refined role permissions, localization (Shona/Ndebele), performance pass on low-end devices.

**Sprint 10 — Billing, Launch Prep & QA**
Pricing tiers implementation, full regression + security review of RLS policies, load testing, beta onboarding of 5–10 real SMEs for feedback before public launch.

---

## 13. Success Metrics

- **Activation**: % of signups who complete a full sale within first session
- **Retention**: % of tenants still logging sales weekly after 30/90 days
- **Offline reliability**: sync success rate, conflict rate per 1,000 offline transactions
- **AI onboarding lift**: signup-to-first-sale time, with vs. without photo-import
- **Revenue**: free-to-paid conversion rate, ARPU, churn

---

## 14. Open Questions to Resolve Before/During Sprint 0

- Exact vertical templates to launch with (recommend: general retail + bottle store first, based on volume)
- Which mobile money aggregator terms/fees are most favorable (confirm Paynow vs. direct EcoCash API access)
- Current fiscalisation, VAT/invoice and data-handling requirements (confirm with a Zimbabwe tax/compliance professional before claiming compliance)
- Which FX-rate source and approval policy shops trust; whether prices are fixed in USD or rate-derived per product/category
- Whether a native Android wrapper (Capacitor) is worth adding later for Play Store discoverability, on top of the PWA
