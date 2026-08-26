# Coolify Deployment and Data-Platform Runbook

## Purpose and status

This is the required implementation and verification contract for StockFlow ZW on the owner-operated Coolify server. It supplements [ADR 0001](../adr/0001-self-hosted-coolify-data-platform.md).

**Current status: planning only.** The local PWA foundation passes lint, typecheck, unit, E2E and production-build checks. No Coolify staging resource, self-hosted Supabase stack, PowerSync service, backup system, or health-checked deployment has been verified. Do not mark Sprint 0 complete until the required evidence below exists.

## Target topology

```text
Internet (HTTPS only)
        │
Coolify / Traefik
        ├── Next.js application              public
        ├── Supabase Kong/API gateway        public, HTTPS
        ├── PowerSync endpoint                public only if browser clients require it
        └── private Coolify network
              ├── Postgres
              ├── GoTrue Auth
              ├── Supabase Storage
              ├── Supabase Realtime
              └── background-job worker
```

Postgres, GoTrue administration endpoints, Storage internals, Realtime internals, PowerSync administration, and background workers must not publish public ports. Each stateful service needs its own persistent volume.

## Required services

| Service | Deployment rule | Verification evidence |
|---|---|---|
| Next.js | Separate Coolify application; production build; `GET /api/health` returns `200` without database secrets in response | Public HTTPS health-check response and Coolify deployment log |
| Postgres / Supabase database | Private network only; persistent volume; RLS-capable Supabase Postgres image; no public port | Network/port configuration, volume record, successful authenticated connection |
| Kong/API | HTTPS only; configured public API URL and JWT keys; no default/demo secrets | Authenticated API smoke test |
| GoTrue | Phone OTP configured and rate-limited; validate the real Africa's Talking integration path before enabling production SMS | Sandbox OTP transcript; explicit provider configuration/hook evidence |
| Storage | Persistent volume or external S3-compatible backend; private service access through Kong only | Upload/read test under tenant authorization |
| Realtime | Private internal service behind the configured public API gateway | Authenticated subscription smoke test |
| PowerSync | Separate Coolify service with persistent config; private Postgres link; least-privilege replication role | Sync-rule test plus replication/publication/slot evidence |
| Worker | Separate private process for scheduled tasks; no application-server cron assumptions | Test job execution and failure alert |

## Security requirements

1. Use Coolify-managed secrets. Never commit secrets, provider tokens, JWT secrets, database URLs, or production keys.
2. Use unique, high-entropy secrets for every Supabase component; remove all compose-template defaults before deployment.
3. Terminate public traffic with Coolify/Traefik HTTPS and redirect HTTP to HTTPS.
4. Put only the application/API endpoints behind public ingress. Do not expose Postgres port `5432` or administration dashboards publicly.
5. Restrict SSH, Coolify administration, firewall and database administrative access to the owner/approved operators.
6. Patch the server OS, Coolify, container images and Supabase/PowerSync versions on a documented cadence; test upgrades in staging first.
7. Enable host/volume encryption where the provider/host design supports it. Treat this as separate from TLS; self-hosting does not automatically give encryption at rest.
8. Capture operational logs and service health without logging passwords, access tokens, full receipts, or customer financial data.

## Database and RLS boundary

The direct Drizzle `DATABASE_URL` connection in `lib/db/client.ts` is currently foundation-only. It must not become a general user-request data path that silently bypasses RLS.

- Browser/user operations must use authenticated Supabase/PostgREST requests with the user's JWT so RLS is active.
- Privileged server operations must use a separate least-privilege role and explicit, transaction-scoped tenant authorization. They require an ADR, an authorization test, and audit logging.
- A service/admin key is for narrowly scoped operational work only; never send it to the browser and never use it as a shortcut around tenant isolation.
- Every tenant-owned table requires `tenant_id`, RLS, and automated cross-tenant read/write denial tests before use.

## Backup, restore and recovery

Before real tenant data is accepted:

1. Schedule encrypted database backups, including enough WAL/archive strategy for the selected recovery objective.
2. Copy backups to storage outside the Coolify host; a backup stored only on the production server does not protect against host loss.
3. Define retention, owner, recovery-point objective (RPO) and recovery-time objective (RTO).
4. Test a restore into an isolated environment and reconcile restored stock, sales and ledger data.
5. Alert on failed backup, low disk space, unhealthy services, and replication-slot/WAL growth.

Record the backup location class, retention and restore-test date in the Sprint 0 handoff without recording credentials.

## PowerSync requirements

- Confirm the selected self-hosted PowerSync edition, licensing, supported Postgres/Supabase versions and upgrade procedure before production deployment.
- Configure logical replication deliberately: publication, replication slot, WAL retention/monitoring and a narrowly privileged replication role.
- Keep sync rules tenant-scoped and review them like RLS policies. Sync rules must never replicate another tenant's data to a device.
- Verify a browser client can queue an offline operation, reconnect, synchronize exactly once, and surface a conflict without data loss.

## Required environment-variable inventory

Populate `.env.example` with names and non-secret descriptions only. Add a variable only when its owning service exists.

```text
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
AFRICASTALKING_USERNAME=
AFRICASTALKING_API_KEY=
```

PowerSync, storage, WhatsApp, Paynow, AI and worker variables are added in their owning sprint—not prefilled with fabricated values.

## Coolify staging checklist

- [ ] Create a dedicated StockFlow ZW Coolify project and staging environment.
- [ ] Add separate stateful-service volumes; record their purpose in infrastructure documentation.
- [ ] Deploy the self-hosted Supabase components with production secrets and private networking.
- [ ] Deploy the Next.js app with a health check at `/api/health`.
- [ ] Configure an HTTPS staging domain and verify the PWA shell and sync-status component load.
- [ ] Configure logs, uptime/error monitoring and deployment rollback procedure.
- [ ] Configure encrypted off-host backup and perform a restore test.
- [ ] Document database/API public URLs, service names and ports **without** secrets in the Sprint 0 handoff.

## Sprint 0 exit evidence

Claude must add the following to `docs/handoffs/sprint-0.md` before setting its status to `complete`:

1. Coolify staging URL and successful deployment/health-check evidence.
2. Self-hosted Supabase service inventory, private-network/volume confirmation and HTTPS verification.
3. Provider-validated GoTrue/Africa's Talking OTP approach. If a custom SMS hook is needed, record the chosen design in an ADR.
4. Backup policy plus a dated isolated restore-test result.
5. Confirmation that `.env.example` lists applicable names but contains no real value.
6. Remaining discovery-interview decision or documented owner acceptance of hypothesis-only discovery.

## Do not proceed if

- A database, admin service or secret is publicly exposed.
- Backup exists only on the production host, or restore has never been tested.
- The authentication SMS path is assumed rather than sandbox-tested.
- PowerSync logical replication/sync rules are unverified.
- The proposed user-facing server data path bypasses RLS.
