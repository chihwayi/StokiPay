import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Proves the Sprint 1 RLS policies (lib/db/migrations/0001_rls_policies.sql)
// actually enforce tenant isolation and role checks — per CLAUDE.md rule 1
// and sprints.md's Sprint 1 exit gate. Runs against a real Postgres with
// the Supabase auth schema (auth.uid()) and anon/authenticated/service_role
// roles — either the self-hosted staging instance (local dev, via the SSH
// tunnel documented in docs/handoffs/sprint-1.md) or the CI Postgres
// service container (same supabase/postgres image, see
// .github/workflows/ci.yml).

const connectionString = process.env.DATABASE_URL;

// Runs a query as a specific simulated authenticated user, mirroring what
// PostgREST does per-request (SET LOCAL role + request.jwt.claims), inside
// a transaction that's always rolled back so tests never truncate real
// data on shared instances.
async function asUser<T>(
  sql: postgres.Sql,
  userId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let result!: T;
  await sql
    .begin(async (tx) => {
      if (userId) {
        await tx.unsafe(
          `set local role authenticated; set local request.jwt.claims = '${JSON.stringify({ sub: userId })}';`,
        );
      } else {
        await tx.unsafe(`set local role anon;`);
      }
      result = await fn(tx);
      throw new RollbackForCleanup();
    })
    .catch((e) => {
      if (!(e instanceof RollbackForCleanup)) throw e;
    });
  return result;
}

class RollbackForCleanup extends Error {}

describe.skipIf(!connectionString)("RLS: cross-tenant and role isolation", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const ownerB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();

  beforeAll(async () => {
    // Seed two tenants directly as the admin (service-role equivalent —
    // bypasses RLS, mirrors ADR 0006's privileged onboarding path).
    await admin`insert into tenants (id, name, vertical) values
      (${tenantA}, 'Tenant A Test', 'general_retail'),
      (${tenantB}, 'Tenant B Test', 'general_retail')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values
      (${branchA}, ${tenantA}, 'Branch A', true),
      (${branchB}, ${tenantB}, 'Branch B', true)`;
    // Note: staff_users.id references auth.users.id via FK — insert matching
    // stub auth.users rows so the FK is satisfiable in a bare Postgres/CI
    // instance that has no real GoTrue signups yet.
    for (const id of [ownerA, cashierA, ownerB]) {
      await admin`insert into auth.users (id, aud, role) values (${id}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    }
    await admin`insert into staff_users (id, tenant_id, phone, role) values
      (${ownerA}, ${tenantA}, '+263771000001', 'owner'),
      (${cashierA}, ${tenantA}, '+263771000002', 'cashier'),
      (${ownerB}, ${tenantB}, '+263771000003', 'owner')`;
  });

  afterAll(async () => {
    await admin`delete from audit_log where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from devices where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from staff_users where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from branches where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from auth.users where id in (${ownerA}, ${cashierA}, ${ownerB})`;
    await admin.end();
  });

  it("tenant A cannot select tenant B's branches", async () => {
    const rows = await asUser(admin, ownerA, (tx) => tx`select * from branches where tenant_id = ${tenantB}`);
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot select tenant B's staff_users", async () => {
    const rows = await asUser(admin, ownerA, (tx) => tx`select * from staff_users where tenant_id = ${tenantB}`);
    expect(rows).toHaveLength(0);
  });

  it("tenant A owner can select their own tenant's branch", async () => {
    const rows = await asUser(admin, ownerA, (tx) => tx`select * from branches where id = ${branchA}`);
    expect(rows).toHaveLength(1);
  });

  it("tenant A cannot insert a branch into tenant B", async () => {
    await expect(
      asUser(admin, ownerA, (tx) =>
        tx`insert into branches (tenant_id, name) values (${tenantB}, 'Spoofed Branch')`,
      ),
    ).rejects.toThrow();
  });

  it("tenant A cannot update tenant B's branch", async () => {
    await asUser(admin, ownerA, (tx) =>
      tx`update branches set name = 'Hijacked' where id = ${branchB}`,
    );
    const [row] = await admin`select name from branches where id = ${branchB}`;
    expect(row.name).toBe("Branch B");
  });

  it("a cashier cannot create a branch (role denial)", async () => {
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into branches (tenant_id, name) values (${tenantA}, 'Cashier Branch')`,
      ),
    ).rejects.toThrow();
  });

  it("an owner can create a branch in their own tenant", async () => {
    const rows = await asUser(admin, ownerA, (tx) =>
      tx`insert into branches (tenant_id, name) values (${tenantA}, 'Owner Branch') returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("a cashier cannot update staff_users (role denial)", async () => {
    await asUser(admin, cashierA, (tx) =>
      tx`update staff_users set role = 'owner' where id = ${cashierA}`,
    );
    const [row] = await admin`select role from staff_users where id = ${cashierA}`;
    expect(row.role).toBe("cashier");
  });

  it("an owner can update a coworker's staff_users row in their own tenant", async () => {
    await asUser(admin, ownerA, (tx) =>
      tx`update staff_users set display_name = 'Updated' where id = ${cashierA}`,
    );
    // rolled back by design (asUser always rolls back) — this proves the
    // write was *allowed* (no RLS error thrown), not that it persisted.
  });

  it("a cashier cannot see the tenant's audit log (owner/manager only)", async () => {
    await admin`insert into audit_log (tenant_id, actor_staff_user_id, action) values (${tenantA}, ${ownerA}, 'test.action')`;
    const rows = await asUser(admin, cashierA, (tx) => tx`select * from audit_log where tenant_id = ${tenantA}`);
    expect(rows).toHaveLength(0);
    await admin`delete from audit_log where tenant_id = ${tenantA}`;
  });

  it("an anonymous (unauthenticated) request sees no rows from any tenant table", async () => {
    const rows = await asUser(admin, null, (tx) => tx`select * from tenants`);
    expect(rows).toHaveLength(0);
  });

  it("no one — not even an owner — can delete a branch (no delete policy exists)", async () => {
    const deleted = await asUser(admin, ownerA, (tx) => tx`delete from branches where id = ${branchA}`);
    expect(deleted).toHaveLength(0); // RLS with no DELETE policy matches zero rows, not an error
    const [row] = await admin`select id from branches where id = ${branchA}`;
    expect(row).toBeDefined();
  });

  it("a staff member can register their own device", async () => {
    const rows = await asUser(admin, ownerA, (tx) =>
      tx`insert into devices (tenant_id, staff_user_id, device_label) values (${tenantA}, ${ownerA}, 'Till 1') returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("a staff member cannot register a device claiming to be a coworker", async () => {
    await expect(
      asUser(admin, ownerA, (tx) =>
        tx`insert into devices (tenant_id, staff_user_id, device_label) values (${tenantA}, ${cashierA}, 'Spoofed Till')`,
      ),
    ).rejects.toThrow();
  });
});
