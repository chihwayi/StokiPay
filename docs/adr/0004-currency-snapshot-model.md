# ADR 0004 — Multi-currency storage and exchange-rate snapshot model

## Status

`accepted`

## Context

`sprints.md`'s locked delivery decisions require: "A transaction stores original amount/currency, rate snapshot, source, approval and reporting value." Reports must never silently apply today's exchange rate to historical transactions (`project_description.md` §10). Supported active currencies are ZiG, USD and ZAR; legacy ZWL is historical-only (`CLAUDE.md` rule 5). This must be locked before Sprint 2 (price lists) and Sprint 3 (multi-currency tender), since it defines the money columns every later financial table depends on.

## Options considered

1. **Store only a reporting-currency amount, convert at write time.** Simplest schema, but destroys the ability to show "what the customer actually paid" and makes any later dispute/audit or rate-source correction impossible to reconstruct.
2. **Store original amount/currency + a rate snapshot embedded per transaction, with a separate versioned `exchange_rates` table for source/approval history.** Slightly more schema, but satisfies the "never use today's rate for history" requirement structurally rather than by convention, and gives an audit trail of who approved which rate and when.

## Decision

Adopt option 2. Concretely, every monetary transaction (sale, payment, refund, cash-up count, price-list entry) stores:

- `amount_minor` — integer minor units (never floating point), per `docs/architecture.md`'s convention.
- `currency_code` — one of `ZIG`, `USD`, `ZAR` for active transactions; `ZWL` permitted only on historical/imported records, never selectable for a new transaction.
- `exchange_rate_snapshot` — the rate(s) needed to convert this transaction's currency to the tenant's reporting currency at the moment of the transaction, copied by value onto the transaction row (not a foreign key alone) so it survives even if the source `exchange_rates` row is later corrected or superseded.
- `reporting_amount_minor` / `reporting_currency_code` — the converted value in the tenant's chosen reporting currency, computed once at transaction time and stored, not recomputed at report time.
- `rate_source` and `rate_approved_by` — which feed/manual entry produced the rate and which authorized user (rate-role only, per Sprint 2) approved it.

A separate `exchange_rates` table is time-versioned (`effective_from`, `source`, `approved_by`) and is the thing owner/manager users edit; individual transactions only ever read a rate at the moment of commit and then freeze their own copy. ZiG precision (decimal places, minor-unit divisor) is documented in `lib/db/` schema comments before the first migration that uses it, since ZiG's minor-unit convention is not yet universally standardized in the same way USD cents are.

## Consequences

- **Positive:** Reports are reconstructable and auditable without needing historical exchange-rate table state to still exist in its original form; changing today's rate can never silently reshape yesterday's profit report (Sprint 5's acceptance evidence directly tests this).
- **Costs/risks:** Slightly wider transaction rows; every write path that creates a monetary transaction must resolve and snapshot a rate even for reporting-currency-only transactions (rate = 1), which adds a small amount of write-path complexity everywhere, by design (no special-cased "same currency, skip the rate logic" branch).
- **Migration or verification needed:** Sprint 2 (price lists / rate approval role) and Sprint 5 ("a changed product cost does not alter historic profit," "reports display original currency and rate context") acceptance evidence must test against this exact column set.
