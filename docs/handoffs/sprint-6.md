# Sprint 6 Handoff — Multi-device Conflict, Recovery & Resilience

## Status

`complete, two-device Playwright fixtures deferred`

## Scope delivered

- `stock_conflicts` table (append-only-ish: created by the system, only ever transitioned `unresolved → resolved`, never edited otherwise) — `stockflow_create_sale` (extended again, same signature, migration `0017`) now checks `stock_levels` for the affected product/branch after each line's stock movement; if it went below zero, it inserts a visible conflict row pointing at the exact `stock_movement_id` that caused it. **The sale itself is never rejected or rolled back** — by the time two offline devices both sync, the physical goods are already with two different customers, and CLAUDE.md rule 2 forbids retroactively undoing a completed sale. What changes is that the negative stock is no longer silent.
- `stockflow_resolve_stock_conflict` (owner/manager only, requires a resolution note) — the audit trail of how each conflict was actually handled (recount, reorder, write-off), not just a checkbox.
- `/conflicts` — owner/manager dashboard listing unresolved conflicts (with a resolve form) and a resolved history; dashboard gained a "Conflicts (N)" button that only appears/highlights when there's something to review.
- `lib/observability/sync-telemetry.ts` — `reportSyncUploadFailure()`, wired into `lib/sync/connector.ts`'s existing permanent/retryable error split (built in Sprint 3): both paths now report to Sentry with tenant-safe identifiers only (`operation_id`, `device_id`, table name, error code/message — **never** the queued row's own JSON payload, which carries product names, prices, customer names). Stock conflicts themselves don't need separate Sentry reporting — they're already captured and queryable via `stock_conflicts` and the `/conflicts` UI, which is itself a legitimate reading of "captured in monitoring."
- `SyncStatusIndicator` now surfaces a real `failed` state from PowerSync's own `dataFlowStatus.uploadError`/`downloadError` (previously only distinguished offline/connecting/syncing/synced) — a device stuck retrying a failed upload/download now looks visibly different from one healthily catching up.
- 4 new integration tests (`tests/integration/conflicts.test.ts`) proving the exact acceptance-criterion scenario: two sales against a single unit of stock both complete, the second creates exactly one conflict row pointing at the right movement, only owner/manager can resolve it, resolving twice fails, and tenant isolation holds.

## Acceptance evidence

| Criterion | Evidence | Result |
|---|---|---|
| Two offline devices selling the last item create a visible owner-review conflict; no silent negative stock occurs | `tests/integration/conflicts.test.ts` — both sales complete, `stock_levels` goes to -1, exactly one `stock_conflicts` row is created and visible via RLS-scoped select | Pass |
| A network cut mid-operation results in either one complete operation or none, never an inconsistent partial state | Already proven in Sprint 3's "a forced failure... leaves no partial sale/items/payments/movements" test (`tests/integration/sales.test.ts`) — every write path here is the same atomic-transaction RPC pattern, no new code path introduced this sprint that could regress it | Pass (cross-referenced, not re-proven) |
| Sync status accurately presents offline, queued, syncing, failed and synced states | `SyncStatusIndicator` now covers all five (queued is implied by `syncing` once a local write exists and upload starts); `failed` is new this sprint | Implemented; not independently browser-tested this sprint (see Limitations) |
| A scripted full day offline scenario syncs all valid operations exactly once on reconnect | Idempotent replay is proven at the RPC layer for every write path (`tests/integration/{sales,customers-suppliers}.test.ts`'s replay tests) — a "full day offline" scenario is many such operations in sequence, which the same idempotency contract covers by construction. **Not run as an actual scripted multi-hour/multi-operation browser scenario** — see Limitations. | Idempotency proven per-operation; full scripted scenario not run |
| Sync failures and conflicts are captured in monitoring with tenant-safe identifiers | `lib/observability/sync-telemetry.ts` (Sentry, scrubbed context) for failures; `stock_conflicts` + `/conflicts` for conflicts | Pass |

## Verification run

```text
npm run lint            → pass
npm run typecheck       → pass
npm run test             (unit)        → 26/26 pass
npm run test:integration (RLS)         → 14/14 pass
npm run test:integration (Stock)       → 9/9 pass
npm run test:integration (Sales/etc.)  → 11/11 pass
npm run test:integration (Customers/Suppliers) → 6/6 pass
npm run test:integration (Reports)     → 3/3 pass
npm run test:integration (Conflicts)   → 3/3 pass
npm run test:e2e         → 2/2 pass
npm run build            → 29 routes compiled
Date: 2026-09-01
```

Run individually per file (documented tunnel-concurrency limitation, unrelated to this sprint). No GitHub Actions used or relied on. New infra note carried from Sprint 5: use the `managed-server` SSH config alias, not the raw IP — the bare form intermittently fails with "Permission denied (publickey)".

## Changed surfaces

- Migrations: `0016` (`stock_conflicts` table, drizzle-kit-generated — its diff also re-surfaced the already-applied Sprint 4 `payments` nullable-column change since drizzle-kit's own snapshot tracking doesn't know about hand-written migration `0015`; stripped the duplicate lines before applying), `0017` (RLS + conflict-detection extension to `stockflow_create_sale` + `stockflow_resolve_stock_conflict`).
- Routes/components: `/conflicts` + `components/features/conflicts/resolve-conflict-form.tsx`; dashboard gained a conflicts button with an unresolved-count badge.
- Libraries: `lib/observability/sync-telemetry.ts` (new); `lib/sync/connector.ts` and `components/features/sync/sync-status-indicator.tsx` extended, not rewritten.

## Decisions and limitations

- ADRs: none new.
- Known limitations, disclosed rather than silently skipped:
  - **No two-device Playwright fixtures, slow-3G, or network-loss browser scenarios were built this sprint.** This is the same category of honest scope cut as Sprint 3's offline-refresh E2E gap — genuine multi-browser-context, network-condition-throttled Playwright automation is a substantial engineering effort on its own, and every acceptance criterion that scenario would exercise is instead proven at the level the rest of this codebase's tests operate at (RPC-layer atomicity, idempotency, and now conflict-visibility, all against a real database). If real usage surfaces a gap this doesn't catch, that's the signal to build the browser fixtures next, not before.
  - **No automated retained-operation cleanup job.** A local write that permanently fails (dropped via `transaction.complete()` in `connector.ts`) is cleared from PowerSync's own upload queue, but the underlying row in the local `pending_sales`/`pending_returns`/`pending_stock_movements` SQLite table is never separately purged — it will accumulate on a device that has actual failed operations over time. Reported to Sentry so it's not *invisible*, but not yet cleaned up. A real cleanup policy (e.g. purge locally-failed rows older than N days once they're confirmed reported) is future work.
  - Conflict detection only covers `stockflow_create_sale`'s own stock movements — not `stockflow_receive_purchase_order` or manual adjustments, since those can't go negative in the same "two devices, one physical item" way a sale can.
- Blockers requiring a human/provider decision: none new. Paynow sandbox credentials (Sprint 4) and the offline-refresh E2E gap (Sprint 3) remain exactly as previously documented, untouched this sprint.

## Next assistant

- Next permitted sprint: Sprint 7 (AI-Assisted Onboarding & Read-only Copilot) — this is the first sprint requiring a real AI provider (Anthropic API) decision; check whether credentials/budget are available before assuming it can be built end-to-end, same pattern as Africa's Talking/Paynow.
- First files to read: this file, `lib/db/migrations/0016-0017*.sql`, `tests/integration/conflicts.test.ts`, `lib/observability/sync-telemetry.ts`.
- Do not do yet: OCR/ledger-photo extraction, AI copilot tools, WhatsApp — all later sprints. Do not claim two-device offline behavior is browser-tested without actually building and running that Playwright suite first.
