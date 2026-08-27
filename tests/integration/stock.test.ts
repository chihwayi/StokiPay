import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser } from "./test-helpers";

// Proves Sprint 2's core accounting-truth acceptance criteria
// (sprints.md): every stock change is an immutable movement with actor/
// device/idempotency key, stock level reconciles to the sum of
// movements, blind counts hide the expected quantity from the counter,
// and only owner/manager can alter products/rates.

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Stock: movements, reconciliation, blind counts", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const branchA = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const deviceOwner = randomUUID();
  const deviceCashier = randomUUID();
  const productA = randomUUID();

  beforeAll(async () => {
    await admin`insert into tenants (id, name, vertical) values (${tenantA}, 'Stock Test Tenant', 'general_retail')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values (${branchA}, ${tenantA}, 'Main', true)`;
    for (const id of [ownerA, cashierA]) {
      await admin`insert into auth.users (id, aud, role) values (${id}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    }
    await admin`insert into staff_users (id, tenant_id, phone, role) values
      (${ownerA}, ${tenantA}, '+263771100001', 'owner'),
      (${cashierA}, ${tenantA}, '+263771100002', 'cashier')`;
    await admin`insert into devices (id, tenant_id, staff_user_id) values
      (${deviceOwner}, ${tenantA}, ${ownerA}),
      (${deviceCashier}, ${tenantA}, ${cashierA})`;
    await admin`insert into products (id, tenant_id, name) values (${productA}, ${tenantA}, 'Bread Loaf')`;
  });

  afterAll(async () => {
    await admin`delete from stock_movements where tenant_id = ${tenantA}`;
    await admin`delete from stock_count_lines where stock_count_id in (select id from stock_counts where tenant_id = ${tenantA})`;
    await admin`delete from stock_counts where tenant_id = ${tenantA}`;
    await admin`delete from products where tenant_id = ${tenantA}`;
    await admin`delete from exchange_rates where tenant_id = ${tenantA}`;
    await admin`delete from devices where tenant_id = ${tenantA}`;
    await admin`delete from staff_users where tenant_id = ${tenantA}`;
    await admin`delete from branches where tenant_id = ${tenantA}`;
    await admin`delete from tenants where id = ${tenantA}`;
    await admin`delete from auth.users where id in (${ownerA}, ${cashierA})`;
    await admin.end();
  });

  it("a cashier can log a stock receipt on their own device", async () => {
    const rows = await asUser(admin, cashierA, (tx) =>
      tx`insert into stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
        values (${tenantA}, ${branchA}, ${productA}, 'receipt', 20, ${cashierA}, ${deviceCashier}, ${randomUUID()})
        returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("cannot log a movement claiming to be a coworker or a device that isn't yours", async () => {
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into stock_movements
          (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
          values (${tenantA}, ${branchA}, ${productA}, 'receipt', 5, ${ownerA}, ${deviceCashier}, ${randomUUID()})`,
      ),
    ).rejects.toThrow();

    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into stock_movements
          (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
          values (${tenantA}, ${branchA}, ${productA}, 'receipt', 5, ${cashierA}, ${deviceOwner}, ${randomUUID()})`,
      ),
    ).rejects.toThrow();
  });

  it("an adjustment without a reason is rejected (reason-coded adjustments)", async () => {
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into stock_movements
          (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
          values (${tenantA}, ${branchA}, ${productA}, 'adjustment', -2, ${cashierA}, ${deviceCashier}, ${randomUUID()})`,
      ),
    ).rejects.toThrow();
  });

  it("replaying the same operation_id does not duplicate the movement", async () => {
    const opId = randomUUID();
    await admin`insert into stock_movements
      (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
      values (${tenantA}, ${branchA}, ${productA}, 'receipt', 3, ${cashierA}, ${deviceCashier}, ${opId})`;
    await expect(
      admin`insert into stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
        values (${tenantA}, ${branchA}, ${productA}, 'receipt', 3, ${cashierA}, ${deviceCashier}, ${opId})`,
    ).rejects.toThrow();
    const [{ count }] = await admin`select count(*)::int from stock_movements where operation_id = ${opId}`;
    expect(count).toBe(1);
    await admin`delete from stock_movements where operation_id = ${opId}`;
  });

  it("reconciliation: stock_levels equals the sum of stock_movements", async () => {
    await admin`delete from stock_movements where tenant_id = ${tenantA}`;
    const movements = [
      { qty: 10, type: "receipt", reason: null },
      { qty: 5, type: "receipt", reason: null },
      { qty: -3, type: "adjustment", reason: "damaged" },
      { qty: 7, type: "adjustment", reason: "supplier top-up" },
      { qty: -1, type: "adjustment", reason: "shrinkage" },
    ];
    for (const m of movements) {
      await admin`insert into stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity_delta, reason, actor_staff_user_id, device_id, operation_id)
        values (${tenantA}, ${branchA}, ${productA}, ${m.type}, ${m.qty}, ${m.reason}, ${ownerA}, ${deviceOwner}, ${randomUUID()})`;
    }
    const expected = movements.reduce((a, b) => a + b.qty, 0);
    const [row] = await admin`select quantity from stock_levels where tenant_id = ${tenantA} and product_id = ${productA}`;
    expect(row.quantity).toBe(expected);
  });

  it("a cashier cannot create a product (rate-role restriction)", async () => {
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into products (tenant_id, name, sell_price_minor) values (${tenantA}, 'Cashier Product', 500)`,
      ),
    ).rejects.toThrow();
  });

  it("a cashier cannot approve an exchange rate", async () => {
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into exchange_rates (tenant_id, base_currency, quote_currency, rate, source, approved_by)
          values (${tenantA}, 'USD', 'ZIG', 32.5, 'manual', ${cashierA})`,
      ),
    ).rejects.toThrow();
  });

  it("an owner can approve an exchange rate", async () => {
    const rows = await asUser(admin, ownerA, (tx) =>
      tx`insert into exchange_rates (tenant_id, base_currency, quote_currency, rate, source, approved_by)
        values (${tenantA}, 'USD', 'ZIG', 32.5, 'manual', ${ownerA}) returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it("blind count: counter cannot set expected_quantity, and submit fills it in without revealing it beforehand", async () => {
    await admin`delete from stock_movements where tenant_id = ${tenantA}`;
    await admin`insert into stock_movements
      (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id)
      values (${tenantA}, ${branchA}, ${productA}, 'receipt', 50, ${ownerA}, ${deviceOwner}, ${randomUUID()})`;

    const countId = randomUUID();
    await admin`insert into stock_counts (id, tenant_id, branch_id, created_by) values (${countId}, ${tenantA}, ${branchA}, ${cashierA})`;

    // Counter tries to sneak in an expected_quantity — rejected by RLS.
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`insert into stock_count_lines (stock_count_id, product_id, counted_quantity, expected_quantity)
          values (${countId}, ${productA}, 47, 50)`,
      ),
    ).rejects.toThrow();

    // Legitimate blind entry: no expected_quantity.
    const inserted = await asUser(admin, cashierA, (tx) =>
      tx`insert into stock_count_lines (stock_count_id, product_id, counted_quantity)
        values (${countId}, ${productA}, 47) returning expected_quantity`,
    );
    expect(inserted[0].expected_quantity).toBeNull();

    // Submit (counter's own count) computes expected server-side.
    const afterSubmit = await asUser(admin, cashierA, async (tx) => {
      await tx`select stockflow_submit_stock_count(${countId})`;
      return tx`select expected_quantity, counted_quantity from stock_count_lines where stock_count_id = ${countId}`;
    });
    expect(afterSubmit[0].expected_quantity).toBe(50);
    expect(afterSubmit[0].counted_quantity).toBe(47);

    // Cashier cannot approve their own submitted count.
    await expect(
      asUser(admin, cashierA, (tx) => tx`select stockflow_approve_stock_count(${countId})`),
    ).rejects.toThrow();

    // Owner approves — variance (47 - 50 = -3) becomes a movement.
    const afterApprove = await asUser(admin, ownerA, async (tx) => {
      await tx`select stockflow_approve_stock_count(${countId})`;
      return tx`select movement_type, quantity_delta from stock_movements where tenant_id = ${tenantA} and movement_type = 'count_variance'`;
    });
    expect(afterApprove).toHaveLength(1);
    expect(afterApprove[0].quantity_delta).toBe(-3);
  });
});
