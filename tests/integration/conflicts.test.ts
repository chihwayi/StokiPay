import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserPersist } from "./test-helpers";

// Proves Sprint 6's core acceptance criterion (sprints.md): two offline
// devices selling the last item both complete (the goods are already
// gone to two different customers in the real world by the time they
// sync — CLAUDE.md rule 2 forbids retroactively undoing a completed
// sale), but the resulting negative stock is never silent — it creates
// a visible, owner-reviewable stock_conflicts row.

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Multi-device stock conflicts", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const branchA = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const deviceOwner = randomUUID();
  const deviceCashier1 = randomUUID();
  const deviceCashier2 = randomUUID();
  const productA = randomUUID();

  beforeAll(async () => {
    await admin`insert into tenants (id, name, vertical, reporting_currency) values (${tenantA}, 'Conflicts Test Tenant', 'general_retail', 'USD')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values (${branchA}, ${tenantA}, 'Main', true)`;
    await admin`insert into auth.users (id, aud, role) values (${ownerA}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    await admin`insert into auth.users (id, aud, role) values (${cashierA}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    await admin`insert into staff_users (id, tenant_id, branch_id, phone, role) values
      (${ownerA}, ${tenantA}, ${branchA}, '+263771500001', 'owner'),
      (${cashierA}, ${tenantA}, ${branchA}, '+263771500002', 'cashier')`;
    await admin`insert into devices (id, tenant_id, staff_user_id) values
      (${deviceOwner}, ${tenantA}, ${ownerA}),
      (${deviceCashier1}, ${tenantA}, ${cashierA}),
      (${deviceCashier2}, ${tenantA}, ${cashierA})`;
    await admin`insert into products (id, tenant_id, name, cost_price_minor, sell_price_minor, price_currency) values
      (${productA}, ${tenantA}, 'Last Crate of Soda', 500, 1000, 'USD')`;
    // Exactly one unit in stock — the scenario two offline devices can race over.
    await admin`insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id) values
      (${tenantA}, ${branchA}, ${productA}, 'receipt', 1, ${ownerA}, ${deviceOwner}, ${randomUUID()})`;
  });

  afterAll(async () => {
    await admin`delete from stock_conflicts where tenant_id = ${tenantA}`;
    await admin`delete from payments where tenant_id = ${tenantA}`;
    await admin`delete from sale_items where tenant_id = ${tenantA}`;
    await admin`delete from sales where tenant_id = ${tenantA}`;
    await admin`delete from stock_movements where tenant_id = ${tenantA}`;
    await admin`delete from products where tenant_id = ${tenantA}`;
    await admin`delete from devices where tenant_id = ${tenantA}`;
    await admin`delete from staff_users where tenant_id = ${tenantA}`;
    await admin`delete from branches where tenant_id = ${tenantA}`;
    await admin`delete from tenants where id = ${tenantA}`;
    await admin`delete from auth.users where id in (${ownerA}, ${cashierA})`;
    await admin.end();
  });

  it("two devices selling the last unit both complete; the second creates a visible conflict, never silent negative stock", async () => {
    // Device 1 (offline, syncs first): sells the last unit. Succeeds, no conflict.
    const sale1 = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier1}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 1000 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 1000, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    expect(sale1).toBeTruthy();

    const [levelAfterFirst] = await admin`select quantity from stock_levels where tenant_id = ${tenantA} and branch_id = ${branchA} and product_id = ${productA}`;
    expect(levelAfterFirst.quantity).toBe(0);

    const conflictsAfterFirst = await admin`select * from stock_conflicts where tenant_id = ${tenantA}`;
    expect(conflictsAfterFirst).toHaveLength(0);

    // Device 2 (also offline, unaware device 1 already sold it): sells
    // the "same" last unit. The sale still completes — the customer
    // already has the goods — but must not silently go negative.
    const sale2 = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier2}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 1000 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 1000, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    expect(sale2).toBeTruthy();
    expect(sale2).not.toBe(sale1);

    const [levelAfterSecond] = await admin`select quantity from stock_levels where tenant_id = ${tenantA} and branch_id = ${branchA} and product_id = ${productA}`;
    expect(levelAfterSecond.quantity).toBe(-1);

    const conflicts = await admin`select * from stock_conflicts where tenant_id = ${tenantA}`;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resulting_quantity).toBe(-1);
    expect(conflicts[0].resolved).toBe(false);

    const [movement] = await admin`select id from stock_movements where id = ${conflicts[0].stock_movement_id}`;
    expect(movement).toBeTruthy(); // conflict points at the actual movement that caused it
  });

  it("only owner/manager can resolve a conflict, and only once", async () => {
    const [conflict] = await admin`select id from stock_conflicts where tenant_id = ${tenantA}`;

    await expect(
      asUser(admin, cashierA, (tx) => tx`select stockflow_resolve_stock_conflict(${conflict.id}, 'recounted, all good')`),
    ).rejects.toThrow();

    await asUserPersist(admin, ownerA, (tx) =>
      tx`select stockflow_resolve_stock_conflict(${conflict.id}, 'Recounted physical stock, reordered from supplier')`,
    );

    const [resolved] = await admin`select * from stock_conflicts where id = ${conflict.id}`;
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolved_by).toBe(ownerA);
    expect(resolved.resolution_note).toBe("Recounted physical stock, reordered from supplier");

    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_resolve_stock_conflict(${conflict.id}, 'resolving again')`),
    ).rejects.toThrow();
  });

  it("tenant B cannot see tenant A's stock conflicts", async () => {
    const tenantB = randomUUID();
    const ownerB = randomUUID();
    await admin`insert into tenants (id, name, vertical) values (${tenantB}, 'Conflicts Test Tenant B', 'general_retail')`;
    await admin`insert into auth.users (id, aud, role) values (${ownerB}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    await admin`insert into staff_users (id, tenant_id, phone, role) values (${ownerB}, ${tenantB}, '+263771500099', 'owner')`;

    try {
      const rows = await asUser(admin, ownerB, (tx) => tx`select * from stock_conflicts where tenant_id = ${tenantA}`);
      expect(rows).toHaveLength(0);
    } finally {
      await admin`delete from staff_users where tenant_id = ${tenantB}`;
      await admin`delete from tenants where id = ${tenantB}`;
      await admin`delete from auth.users where id = ${ownerB}`;
    }
  });
});
