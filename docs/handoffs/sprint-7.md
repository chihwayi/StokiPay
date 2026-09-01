# Sprint 7 Handoff — AI-Assisted Onboarding & Read-only Copilot

## Status

`complete, live AI calls deferred (no ANTHROPIC_API_KEY — owner's explicit decision)`

## Scope delivered

- `lib/integrations/anthropic.ts` — Anthropic SDK adapter. `isAiConfigured()`, `extractLedgerPhoto()` (photo → draft line items via `claude-sonnet-5` vision), `askCopilot()` (a tool-use loop, capped at 4 turns, feeding `tool_result`s back until the model returns plain text). No `ANTHROPIC_API_KEY` was available this sprint — every export returns a typed "not configured" result rather than throwing or pretending, the same dev-fallback pattern as `lib/integrations/sms.ts` (Sprint 1) and `lib/integrations/paynow.ts` (Sprint 4). Every manual flow built in Sprints 1–6 is unaffected either way.
- OCR draft workflow: `ocr_drafts` table (migration `0018`/`0019`) — a photo extraction only ever creates a `status='draft'` row (`app/api/ai/extract-ledger-photo/route.ts`); `stockflow_confirm_ocr_draft` is the *only* path from a draft to a real `products`/`stock_movements` row, requires owner/manager, takes the human-reviewed lines (not the raw extraction — an owner can correct OCR mistakes or zero out a misread line before anything is created), and is one-shot (`status` flips to `confirmed`/`rejected`, both terminal). `stockflow_reject_ocr_draft` discards a draft outright.
- Read-only, tenant-scoped copilot tools (`lib/ai/copilot-tools.ts`): `get_profit_summary`, `get_best_worst_sellers`, `get_debt_summary` — all reuse Sprint 5's `buildReport()`/`lib/domain/reports.ts` calculation functions (plus new `computeBestWorstSellers`) so the copilot's numbers can never independently drift from the on-screen/exported report figures. `app/api/ai/copilot/route.ts` wires this to `askCopilot()`; every tool's `tenant_id` comes only from the requesting staff member's own session lookup in the route, never from a model-supplied parameter — see the safety-design comment in `lib/ai/copilot-tools.ts`.
- Anomaly scan + dismissible alerts: `alerts` table + `stockflow_run_anomaly_scan` (service-role only, scans unresolved `stock_conflicts` >24h old, unreviewed `cash_variances`, and customers with ≥3 credit sales in 7 days) + `stockflow_dismiss_alert`. No scheduler exists yet — `/api/ai/anomaly-scan` is a manually-triggered owner/manager button (`RunScanButton`) on `/alerts`.
- UI: `/ledger-scan` (photo upload → editable draft lines with per-line confidence badges → confirm/reject), `/copilot` (chat-style Q&A with suggested questions and a "checked: ..." tool-call disclosure per answer), `/alerts` (active/dismissed lists, run-scan button for owner/manager). Dashboard gained Alerts/Copilot/Scan ledger buttons.
- `tests/integration/ai-copilot-ocr.test.ts` (12 tests) — the sprint's adversarial proof: a copilot-tool-shaped query scoped to another tenant's id returns zero rows under RLS regardless of what the query asks for (the second, independent layer under `lib/ai/copilot-tools.ts`'s own session-derived scoping); the anomaly-scan RPC rejects any session-authenticated caller; OCR draft upload rejects a spoofed uploader/device; only owner/manager can confirm/reject; a confirmed draft creates products/stock only from the *reviewed* lines, never the raw extraction; a confirmed or rejected draft can never be acted on again; tenant A cannot see, confirm, or dismiss tenant B's drafts/alerts; double-dismiss fails.
- `tests/unit/reports.test.ts` gained 3 tests for the new `computeBestWorstSellers` pure function.

## A real bug this sprint's tests caught

Writing the "no session-authenticated role can call the anomaly scan RPC directly" test failed on the first run — `stockflow_run_anomaly_scan` and (checking the same class of function) `stockflow_reconcile_provider_payment` (Sprint 4) were both callable by the `authenticated` Postgres role despite their migrations only ever writing `grant execute ... to service_role` and never granting `authenticated`. Root cause: this Supabase instance's `ALTER DEFAULT PRIVILEGES` setup grants `EXECUTE` on every new public-schema function to `anon`/`authenticated`/`service_role` automatically (confirmed via `pg_proc.proacl`), so *not* granting to `authenticated` is not the same as *denying* it — the grant to `service_role` was additive on top of an already-open default, not a restriction. Fixed via `lib/db/migrations/0020_revoke_public_execute_on_service_role_functions.sql`, an explicit `revoke execute ... from public, anon, authenticated` on both functions, applied and verified against staging (`pg_proc.proacl` now shows only `postgres`/`service_role`). This was a real, previously-undetected authorization gap on the Sprint 4 function, not just a Sprint 7 issue — worth an explicit callout since `stockflow_reconcile_provider_payment` handles payment reconciliation.

## Acceptance evidence

| Criterion | Evidence | Result |
|---|---|---|
| OCR output is always a draft; no product or stock record is created until an owner confirms it | `tests/integration/ai-copilot-ocr.test.ts`'s "confirming a draft creates products/stock only from the owner-reviewed lines" and the two draft-immutability tests; `extractLedgerPhoto`'s own route never touches `products`/`stock_movements` | Pass |
| A fixed evaluation set of handwritten samples has documented extraction quality and correction rate | **Not built.** No `ANTHROPIC_API_KEY` this sprint means `extractLedgerPhoto` has never made a real model call — there is nothing to evaluate yet. See Limitations. | Not done (blocked on credentials) |
| Copilot answers required profit, best/worst seller and debt questions using returned tenant-scoped figures with cited period/source | `lib/ai/copilot-tools.ts`'s three tools cover exactly these three categories, each returning an explicit `citation` field (date range + currency, or "live balance"), reusing `buildReport()`/`computeBestWorstSellers`; `askCopilot()`'s system prompt also instructs the model to always cite the range/figures it used. **Not exercised against a real model this sprint** — see Limitations. | Implemented; live-answer quality unverified (blocked on credentials) |
| Adversarial tests demonstrate the copilot cannot access another tenant or issue writes | `tests/integration/ai-copilot-ocr.test.ts`: RLS-scoped queries return zero rows for a foreign tenant id even when the query itself asks for it; every copilot tool only ever does `.select()`/reads, never a write; `askCopilot()`'s tool loop only calls the tools it's given, and none of `get_profit_summary`/`get_best_worst_sellers`/`get_debt_summary` accept a tenant parameter from the model at all (checked by reading `COPILOT_TOOL_DEFINITIONS`'s `input_schema`s — none declare a tenant/business field) | Pass |
| AI outage leaves manual onboarding and all POS/stock flows usable | True by construction — every Sprint 1–6 route/RPC is untouched this sprint; `isAiConfigured()` is currently `false` in this exact staging environment right now, and the full Sprint 1–6 verification suite (all 7 integration files, unit tests, e2e, build) still passes with it in that state (see Verification run below, same environment) | Pass |

## Verification run

```text
npm run lint                                    → pass
npm run typecheck                                → pass
npm run test              (unit)                 → 29/29 pass (26 pre-existing + 3 new computeBestWorstSellers tests)
npm run test:integration  (RLS)                  → 14/14 pass
npm run test:integration  (Stock)                → 9/9 pass
npm run test:integration  (Sales/Returns/CashUp)  → 11/11 pass
npm run test:integration  (Customers/Suppliers)   → 6/6 pass
npm run test:integration  (Reports)              → 3/3 pass
npm run test:integration  (Conflicts)            → 3/3 pass
npm run test:integration  (AI copilot/OCR)       → 12/12 pass (new this sprint)
npm run test:e2e                                  → 2/2 pass
npm run build                                     → 34 routes compiled (5 new: /alerts, /copilot, /ledger-scan, /api/ai/copilot, /api/ai/anomaly-scan, /api/ai/extract-ledger-photo)
Date: 2026-09-01
```

Run individually per file (documented tunnel-concurrency limitation, unrelated to this sprint). Added `testTimeout`/`hookTimeout: 20000` to `vitest.integration.config.ts` this sprint — the default 5s was intermittently too short for tests with several sequential round trips over the SSH tunnel (`tests/integration/stock.test.ts`'s blind-count test failed on this basis before the change, consistently, not flakily; passes now). No GitHub Actions used or relied on, per the owner's standing instruction. `managed-server` SSH alias used throughout, not the raw IP.

## Changed surfaces

- Migrations: `0018` (drizzle-kit-generated `ocr_drafts`/`alerts` tables), `0019` (RLS + `stockflow_reject_ocr_draft`/`stockflow_confirm_ocr_draft`/`stockflow_dismiss_alert`/`stockflow_run_anomaly_scan`), `0020` (bug-fix: explicit `revoke execute ... from public, anon, authenticated` on the two service-role-only functions — see "A real bug this sprint's tests caught" above).
- Environment variables added to `.env.example`: **not applied** — this assistant's sandbox blocks writes to `.env.example` (same standing limitation documented in Sprint 0/1's handoffs, still unresolved). `ANTHROPIC_API_KEY` should be added there manually; no real value should ever be committed.
- Routes/components: `/alerts`, `/copilot`, `/ledger-scan`; `app/api/ai/{extract-ledger-photo,copilot,anomaly-scan}/route.ts`; `components/features/alerts/{dismiss-alert-button,run-scan-button}.tsx`; dashboard gained Alerts/Copilot/Scan ledger buttons and an active-alerts count badge.
- Libraries: `lib/integrations/anthropic.ts` (new), `lib/ai/copilot-tools.ts` (new), `lib/domain/reports.ts` (added `computeBestWorstSellers`).

## Decisions and limitations

- ADRs: none new — Sprint 7 didn't change any locked architectural decision, only added within the already-locked "Anthropic API behind tenant-scoped read-only server tools" line in `docs/architecture.md`.
- Known limitations, disclosed rather than silently skipped:
  - **No live AI calls made or verified this sprint.** No `ANTHROPIC_API_KEY` was available (owner's explicit choice, matching Africa's Talking/Paynow's earlier deferrals). `extractLedgerPhoto()`/`askCopilot()` are fully wired and unit-testable at the "not configured" boundary, but neither has ever actually called `claude-sonnet-5`. This means: extraction quality/correction-rate evaluation (acceptance line 2) genuinely cannot exist yet, and copilot answer quality/citation behavior is implemented-per-spec but unverified against real model output.
  - **`.env.example` was not updated** with `ANTHROPIC_API_KEY` — sandbox write restriction, not a decision. Flagged here so the next assistant (or the owner, manually) adds it rather than assuming it's already documented.
  - **No scheduler for the anomaly scan.** `stockflow_run_anomaly_scan` and `/api/ai/anomaly-scan` both exist and work correctly when invoked, but nothing calls the route automatically yet — it's a manual owner/manager button on `/alerts`. A real cron (Coolify scheduled task, or similar) is future work, same "manual trigger now, automate later" pattern this codebase hasn't needed until this sprint.
  - **`stockflow_confirm_ocr_draft` always creates a new product per line, never matches to an existing one.** A ledger entry for a product the shop already stocks will create a duplicate product row rather than adding to existing stock — disclosed in the migration's own comment (0019) and unchanged this sprint; a real product-matching UX (search-as-you-type against existing products, "add to existing" vs "new product" per line) is future work.
  - **No fixed evaluation set of handwritten ledger photos** — can't be built without real model access (see above).
- Blockers requiring a human/provider decision: `ANTHROPIC_API_KEY` (budget/account decision, owner declined for this sprint — same standing status as Paynow sandbox credentials from Sprint 4, both still open).

## Next assistant

- Next permitted sprint: Sprint 8 (WhatsApp, SMS & Notifications) — likely another provider-credential decision point (WhatsApp Business API/Twilio or similar); ask before assuming availability, same pattern as Sprints 1/4/7.
- First files to read: this file, `lib/integrations/anthropic.ts`, `lib/ai/copilot-tools.ts`, `lib/db/migrations/0018-0020*.sql`, `tests/integration/ai-copilot-ocr.test.ts`.
- Do not do yet: WhatsApp/SMS notification templates, structured bot commands — Sprint 8's scope. Do not claim live AI extraction/copilot quality is verified without an actual `ANTHROPIC_API_KEY` and a real evaluation run first. If a key becomes available before Sprint 8, revisit Sprint 7's two "not done"/"unverified" acceptance lines before moving on, since the code path is already built and only needs a real key to exercise.
