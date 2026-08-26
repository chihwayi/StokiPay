# ADR 0006 — Privileged, service-role writes for tenant/staff onboarding

## Status

`accepted`

## Context

`docs/runbooks/coolify-deployment.md`'s "Database and RLS boundary" section requires: "Privileged server operations must use a separate least-privilege role and explicit, transaction-scoped tenant authorization. They require an ADR, an authorization test, and audit logging."

Sprint 1's RLS policies (`lib/db/migrations/0001_rls_policies.sql`) intentionally grant **no** client-side `INSERT` policy on `tenants` or `staff_users`. This is not an oversight — it reflects a genuine chicken-and-egg problem: a brand-new phone-OTP user has no `staff_users` row yet, so `stockflow_auth_tenant_id()` (which looks up `tenant_id` from `staff_users` by `auth.uid()`) returns nothing for them, and no ordinary authenticated-client RLS policy can express "let this brand-new user create their own tenant and become its owner" without also allowing any authenticated user to fabricate a tenant/staff row for someone else.

## Options considered

1. **A permissive INSERT policy on `tenants`/`staff_users` for any authenticated user.** Technically simple, but has no way to stop an already-onboarded user from inserting a second, spoofed `staff_users` row for themselves in a different tenant, or inserting a `staff_users` row impersonating another `auth.uid()`. This directly undermines the tenant-isolation guarantee the whole schema exists to enforce.
2. **A privileged server-side onboarding path using Supabase's `service_role`** (which bypasses RLS by design in the self-hosted Supabase Postgres image), wrapped in a single transaction that: creates the tenant row, creates the first `staff_users` row with role `owner` and `id = auth.uid()` of the requesting session, and writes an `audit_log` entry — all server-side, never exposed as a raw insert the browser can call directly.

## Decision

Adopt option 2. Tenant creation ("finish onboarding") and staff invitation (adding a `manager`/`cashier` under an existing tenant) are both implemented as **Next.js Route Handlers running with the Supabase `service_role` key** (server-only, never sent to the browser, per `docs/runbooks/coolify-deployment.md`'s explicit warning), each:

1. Authenticates the caller's session (verifies their GoTrue JWT) to know *who* is asking.
2. For tenant creation: only allowed if the caller has no existing `staff_users` row yet (prevents an already-onboarded user from creating a second tenant/owner identity through this path — they'd use a separate "switch tenant" flow if that's ever needed, not this one).
3. For staff invitation: only allowed if the caller's own `staff_users` row (looked up server-side) has role `owner` or `manager` in the target tenant — enforced in application code before the privileged write, since RLS itself is bypassed for this connection.
4. Performs the tenant/staff/audit_log writes in one Postgres transaction — either the whole onboarding/invite succeeds or none of it does.
5. Writes an `audit_log` row recording the action, actor, and target — satisfying the runbook's audit-logging requirement for privileged operations.

This keeps `lib/db/client.ts`'s direct `DATABASE_URL` connection (Sprint 0's foundation-only wiring) out of the request path entirely for this — the service-role writes go through Supabase's PostgREST/service-role client (or an equivalent server-side Postgres connection using the dedicated service role), not the anon/authenticated RLS path and not the raw Drizzle foundation connection either, keeping the boundary in `docs/runbooks/coolify-deployment.md` intact: "The direct Drizzle `DATABASE_URL` connection ... must not become a general user-request data path that silently bypasses RLS."

## Consequences

- **Positive:** Tenant/staff-identity creation is centralized in one auditable, transaction-scoped path instead of being expressible as an arbitrary client insert; RLS's lack of an insert policy on these two tables is a deliberate security boundary, not a gap.
- **Costs/risks:** Two more server-side code paths need their own authorization tests (per this ADR's requirement) proving: an already-onboarded user can't create a second tenant through this path, and a cashier can't invite/promote staff through the invite path.
- **Migration or verification needed:** Sprint 1 adds the onboarding and invite-staff route handlers plus tests proving both authorization boundaries above, alongside the cross-tenant RLS denial tests already required by `sprints.md`'s Sprint 1 acceptance evidence.
