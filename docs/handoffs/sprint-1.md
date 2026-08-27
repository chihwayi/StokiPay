# Sprint 1 Handoff — Identity, Tenants & Authorisation

## Status

`in progress` — schema, RLS, onboarding, dashboard and device registration are built, tested and **verified working end-to-end on staging** (real tenant created via the onboarding RPC, dashboard shows it, cleaned up after). Real phone-OTP verification remains blocked on one specific, reproducible GoTrue configuration issue and is intentionally deferred (owner decision, 2026-08-27) — a clearly-labeled, unverified interim sign-in bridge stands in for it.

**Fixed during end-to-end verification:** the onboarding RPC initially failed in the browser with `function stockflow_auth_uid() does not exist` / a 404 from PostgREST. Root cause: `stockflow_auth_uid()` (defined in migration 0002) was missing from the live staging database — lost during the earlier flaky-SSH-tunnel debugging session, not a bug in the migration itself (confirmed: CI's RLS tests pass running the same migration against a fresh Postgres). Fixed by re-applying the function directly, notifying PostgREST to reload its schema cache (`NOTIFY pgrst, 'reload schema'` — necessary any time a function/table is added outside PostgREST's own awareness), and adding `0004_ensure_auth_uid_exists.sql` as a defensive re-apply so a future clean migration run can't reproduce the gap. Re-verified with a real signup → onboarding → dashboard round trip against the live Kong/PostgREST endpoint (not just direct Postgres access), then cleaned up the test data.

## Scope delivered

- `tenants`, `branches`, `staff_users`, `devices`, `audit_log` schema (`lib/db/schema.ts`) with hand-written RLS policies (`lib/db/migrations/0001_rls_policies.sql`, `0002_self_contained_auth_uid.sql`) enforcing tenant isolation and owner/manager-only branch/staff management.
- `stockflow_onboard_tenant` SECURITY DEFINER RPC (`lib/db/migrations/0003_onboarding_function.sql`, ADR 0006) — creates tenant + main branch + owner staff_users row + audit_log entry atomically, scoped to the caller's own JWT (`stockflow_auth_uid()`), not a client-supplied id.
- 14 RLS integration tests (`tests/integration/rls.test.ts`) passing in CI against an ephemeral Postgres and against live staging.
- `apply-migrations.mjs` now tracks applied migrations in a `_migrations` table (idempotent re-runs).
- App routes: `/sign-in`, `/onboarding`, `/dashboard` (redirects: unauthenticated → sign-in, authenticated-no-tenant → onboarding, else shows tenant name/role/sync status/empty state).
- `components/features/auth/device-registration.tsx` — registers a stable `device_id` in `localStorage` and the `devices` table on first dashboard visit (ADR 0003's device-identity half of the idempotency contract).
- `lib/auth/supabase-browser.ts`, `supabase-server.ts` (RLS-scoped, `@supabase/ssr`), `supabase-admin.ts` (service-role, server-only, guarded by the `server-only` package).
- `middleware.ts` — refreshes the Supabase session cookie per `@supabase/ssr`'s recommended pattern.
- ADR 0005's real mechanism, built and deployed but not yet working end-to-end (see Known limitation below):
  - `app/api/auth/sms-hook/route.ts` — GoTrue Send SMS Hook receiver with Standard Webhooks HMAC signature verification.
  - `lib/integrations/sms.ts` — Africa's Talking client, with a dev-fallback (logs + stores the OTP) when `AFRICASTALKING_API_KEY` is unset.
  - `lib/integrations/dev-otp-store.ts`, `app/api/auth/dev-otp/route.ts` — staging-only OTP visibility, inert once real Africa's Talking credentials are set.
  - GoTrue's compose environment on the server was edited directly to add `GOTRUE_HOOK_SEND_SMS_ENABLED/_URI/_SECRETS` (Coolify's `supabase` service template doesn't expose these by default — see `../../coolify-infra/README.md` gotcha #9).
- **Interim sign-in bridge** (`app/api/auth/request-access/route.ts`) — see Known limitation.

## Known limitation — phone OTP verification is not live (deferred, owner decision 2026-08-27)

`signInWithOtp`/GoTrue's Send SMS Hook is fully implemented per ADR 0005, but GoTrue rejects every hook invocation at runtime with `500: Hook requires authorization token`, even though:

- `GOTRUE_HOOK_SEND_SMS_SECRETS` is correctly formatted (confirmed: an incorrectly-formatted secret makes GoTrue fail to *start* with a different error, "invalid secret format" — the container is healthy and running with the current config).
- Our hook receiver (`app/api/auth/sms-hook`) correctly verifies Standard Webhooks HMAC signatures and was never actually reached (GoTrue's hook-call log entry shows a ~1ms duration, far too fast for a real HTTPS round trip — this is failing a local GoTrue precondition before it ever calls out to us).
- The GoTrue binary (`supabase/gotrue:v2.186.0`, upstream repo `supabase/auth`) confirms `conf.HTTPHookSecrets.Decode`/`validateHTTPHookSecrets` exist and parse successfully; the exact runtime check that then rejects the call with "requires authorization token" wasn't identified from the binary strings alone, and GoTrue's docs weren't available to consult during this session.

The owner explicitly deferred chasing this further (2026-08-27): no Africa's Talking gateway account exists yet anyway, so real SMS delivery couldn't be tested end-to-end even with the hook fixed. Revisit once a real gateway account exists — the hook receiver, HMAC verification and dev-fallback plumbing are already built and just need the GoTrue-side issue resolved (or Supabase's actual hook documentation consulted, which wasn't accessible this session).

**Interim measure (still active)**: `app/sign-in` calls `app/api/auth/request-access`, which creates/updates a GoTrue user for the entered phone number and signs them in via the service-role key and a server-generated password — **with no proof of phone ownership whatsoever**. Loudly labeled in the UI ("Testing mode — phone number not yet SMS-verified") and in the route's own code comments. Verified working end-to-end this session (real signup → onboarding → dashboard). **Do not use with real users or real phone numbers that matter** — anyone who knows a phone number can currently claim it.

Next assistant (once a real Africa's Talking account exists, or with access to GoTrue's actual documentation/support channel): identify the real cause of "Hook requires authorization token", fix it, restore `app/sign-in` to `signInWithOtp`/`verifyOtp` (code preserved in git history), delete `app/api/auth/request-access`, and flip `ENABLE_PHONE_AUTOCONFIRM` to `false` per ADR 0005 once verification is real.

## Coolify staging evidence

- App: `https://xad1g9f4595ll32r0xwcyr0o.31.220.84.245.sslip.io` — `/`, `/sign-in`, `/onboarding`, `/dashboard`, `/api/health` all verified live and returning expected status codes/redirects after this sprint's deploys.
- Supabase Kong: `https://supabasekong-o11niv82f82abmmfm95kvy76.31.220.84.245.sslip.io` — `/rest/v1/`, `/auth/v1/health` verified 200 with the anon key.
- `GOTRUE_HOOK_SEND_SMS_SECRET` / `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` set as Coolify-managed env vars on the app resource (real values are recorded locally in `env-snapshot-coolify.local.txt` at the repo root — gitignored, never committed, per the owner's request for a local record of anything set only on the server).
- `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` also added as GitHub Actions repository secrets so CI's build/E2E steps can reach the real staging Auth backend.
- `DATABASE_URL` set on the app currently points at `supabase-db:5432`, which is **not resolvable** from the app's container (different Coolify docker network) — inert until Sprint 2 actually needs the direct Drizzle connection; fix by connecting the app's network to the Supabase service's network (`connect_to_docker_network`) when that's needed.

## Acceptance evidence

| Criterion | Evidence | Result |
|---|---|---|
| A new user reaches an empty dashboard in under 60 seconds (E2E) | Manual verification via the interim bridge; no Playwright E2E written for the authenticated path yet (would need to run against staging or a seeded local Supabase, neither wired into CI yet) | Partial — reachable, but not automated, and gated by the OTP limitation above |
| Tenant A cannot select/insert/update/delete Tenant B rows | `tests/integration/rls.test.ts`, 14 tests, passing in CI and against staging | Done |
| A cashier cannot manage staff/branches | Same test file — role-denial cases | Done at the DB layer; no dedicated UI-level denial test yet (no staff-management UI exists this sprint) |
| Device registration provides a stable device ID | `components/features/auth/device-registration.tsx`, `devices` table + RLS | Done |

## Verification run

```text
Command: npm run lint        → pass
Command: npm run typecheck   → pass
Command: npm run test        → pass (3 tests)
Command: npm run test:integration → pass (14 tests, both locally against staging and in CI against the ephemeral Postgres)
Command: npm run test:e2e    → pass (2 tests — unauthenticated redirect + manifest; no authenticated-path E2E yet)
Command: npm run build       → pass
Date: 2026-08-27
```

CI run: https://github.com/chihwayi/StokiPay/actions (green on the commit implementing this sprint's schema/RLS/onboarding work).

## Changed surfaces

- Migrations: `0000_wild_black_cat.sql` (tables), `0001_rls_policies.sql`, `0002_self_contained_auth_uid.sql`, `0003_onboarding_function.sql`.
- Environment variables added to the Coolify app (not `.env.example` — still blocked by this assistant's sandbox, see Sprint 0 handoff): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `GOTRUE_HOOK_SEND_SMS_SECRET`.
- Routes: `app/sign-in`, `app/onboarding`, `app/dashboard`, `app/api/auth/{sms-hook,dev-otp,request-access}`, `middleware.ts`.
- Services/integrations: `lib/auth/*`, `lib/integrations/{sms,dev-otp-store}.ts`.

## Decisions and limitations

- ADRs created/updated: 0006 (privileged onboarding, implemented as a SECURITY DEFINER RPC rather than a service-role route — a refinement of the ADR's original design, safer since the caller's identity can't be spoofed via a parameter).
- Known limitations: phone OTP verification not live (see above, the headline item); no staff-invite UI/flow yet; no E2E test for the authenticated dashboard path; `DATABASE_URL` on the app is currently unreachable (network isolation, harmless until used).
- Blockers requiring a human/provider decision: same two from Sprint 0 (`.env.example` file access, off-host backup destination) plus the new GoTrue hook investigation above — ideally resolved by consulting Supabase Auth's actual hook documentation or support, which wasn't accessible during this session.

## Next assistant

- Next permitted sprint: continue Sprint 1 (staff invite flow, resolve the OTP hook issue) before starting Sprint 2 — cross-sprint invariant 5 (every core stock/POS write uses the local-first path from first implementation) means Sprint 2 needs a trustworthy identity layer under it.
- First files to read: this file, `docs/adr/0005-*.md`, `docs/adr/0006-*.md`, `app/api/auth/request-access/route.ts` (read the warning comment first).
- Do not do yet: remove the "Testing mode" banner or otherwise present the interim bridge as verified auth; do not build Sprint 2 (products/stock) until the OTP issue is resolved or the owner explicitly accepts shipping without real phone verification for longer.
