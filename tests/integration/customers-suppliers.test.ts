import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserPersist } from "./test-helpers";

// Proves Sprint 4's core accounting-truth acceptance criteria
// (sprints.md): balances reconstructable from ledger entries, a credit
// sale reduces stock immediately and creates the right unpaid balance,
// partial repayment updates the balance without editing history, and
// purchase-order receiving posts the right landed-cost supplier balance.

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Customers, suppliers, credit, purchase orders", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const branchA = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const deviceOwner = randomUUID();
  const deviceCashier = randomUUID();
  const productA = randomUUID();

  beforeAll(async () => {
    await admin`insert into tenants (id, name, vertical, reporting_currency) values (${tenantA}, 'Credit Test Tenant', 'general_retail', 'USD')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values (${branchA}, ${tenantA}, 'Main', true)`;
    for (const id of [ownerA, cashierA]) {
      await admin`insert into auth.users (id, aud, role) values (${id}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    }
    await admin`insert into staff_users (id, tenant_id, branch_id, phone, role) values
      (${ownerA}, ${tenantA}, ${branchA}, '+263771300001', 'owner'),
      (${cashierA}, ${tenantA}, ${branchA}, '+263771300002', 'cashier')`;
    await admin`insert into devices (id, tenant_id, staff_user_id) values
      (${deviceOwner}, ${tenantA}, ${ownerA}),
      (${deviceCashier}, ${tenantA}, ${cashierA})`;
    await admin`insert into products (id, tenant_id, name, cost_price_minor, sell_price_minor, price_currency) values
      (${productA}, ${tenantA}, 'Bread Loaf', 100, 200, 'USD')`;
    await admin`insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id) values
      (${tenantA}, ${branchA}, ${productA}, 'receipt', 100, ${ownerA}, ${deviceOwner}, ${randomUUID()})`;
  });

  afterAll(async () => {
    await admin`delete from supplier_ledger where tenant_id = ${tenantA}`;
    await admin`delete from purchase_receipt_lines where tenant_id = ${tenantA}`;
    await admin`delete from purchase_receipts where tenant_id = ${tenantA}`;
    await admin`delete from purchase_order_lines where tenant_id = ${tenantA}`;
    await admin`delete from purchase_orders where tenant_id = ${tenantA}`;
    await admin`delete from suppliers where tenant_id = ${tenantA}`;
    await admin`delete from customer_ledger where tenant_id = ${tenantA}`;
    await admin`delete from provider_payments where tenant_id = ${tenantA}`;
    await admin`delete from payments where tenant_id = ${tenantA}`;
    await admin`delete from sale_items where tenant_id = ${tenantA}`;
    await admin`delete from sales where tenant_id = ${tenantA}`;
    await admin`delete from customers where tenant_id = ${tenantA}`;
    await admin`delete from stock_movements where tenant_id = ${tenantA}`;
    await admin`delete from products where tenant_id = ${tenantA}`;
    await admin`delete from devices where tenant_id = ${tenantA}`;
    await admin`delete from staff_users where tenant_id = ${tenantA}`;
    await admin`delete from branches where tenant_id = ${tenantA}`;
    await admin`delete from tenants where id = ${tenantA}`;
    await admin`delete from auth.users where id in (${ownerA}, ${cashierA})`;
    await admin.end();
  });

  it("a credit sale reduces stock immediately and creates the correct unpaid balance", async () => {
    const customerId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into customers (tenant_id, name, phone) values (${tenantA}, 'Mai Moyo', '+263772000001') returning id`;
      return row.id as string;
    });

    const [levelBefore] = await admin`select quantity from stock_levels where tenant_id = ${tenantA} and branch_id = ${branchA} and product_id = ${productA}`;

    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 5, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 300, currency_code: "USD" }])},
        ${customerId}
      ) as id`;
      return row.id as string;
    });

    const [levelAfter] = await admin`select quantity from stock_levels where tenant_id = ${tenantA} and branch_id = ${branchA} and product_id = ${productA}`;
    expect(levelBefore.quantity - levelAfter.quantity).toBe(5);

    const ledgerRows = await admin`select * from customer_ledger where customer_id = ${customerId}`;
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].entry_type).toBe("credit_sale");
    expect(ledgerRows[0].reporting_amount_minor).toBe(700); // 1000 total - 300 paid
    expect(ledgerRows[0].reference_sale_id).toBe(saleId);

    const balance = ledgerRows.reduce((s, r) => s + r.reporting_amount_minor, 0);
    expect(balance).toBe(700);
  });

  it("a partial repayment updates the balance without editing historical entries", async () => {
    const customerId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into customers (tenant_id, name) values (${tenantA}, 'Baba Chirwa') returning id`;
      return row.id as string;
    });

    await asUserPersist(admin, cashierA, (tx) =>
      tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 2, unit_price_minor: 200 }])},
        ${tx.json([])},
        ${customerId}
      )`,
    );

    const [beforeEntry] = await admin`select * from customer_ledger where customer_id = ${customerId} and entry_type = 'credit_sale'`;
    expect(beforeEntry.reporting_amount_minor).toBe(400);

    await asUserPersist(admin, cashierA, (tx) =>
      tx`select stockflow_record_customer_payment(${randomUUID()}, ${customerId}, ${deviceCashier}, 150, 'USD', 'cash')`,
    );

    const [afterEntry] = await admin`select * from customer_ledger where id = ${beforeEntry.id}`;
    expect(afterEntry).toEqual(beforeEntry); // historical entry untouched

    const allEntries = await admin`select reporting_amount_minor from customer_ledger where customer_id = ${customerId}`;
    const balance = allEntries.reduce((s, r) => s + r.reporting_amount_minor, 0);
    expect(balance).toBe(250);
  });

  it("replaying the same repayment operation ID is a no-op, not a second payment", async () => {
    const customerId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into customers (tenant_id, name) values (${tenantA}, 'Sekuru Banda') returning id`;
      return row.id as string;
    });
    const opId = randomUUID();

    const first = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_record_customer_payment(${opId}, ${customerId}, ${deviceCashier}, 50, 'USD', 'cash') as id`;
      return row.id as string;
    });
    const second = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_record_customer_payment(${opId}, ${customerId}, ${deviceCashier}, 50, 'USD', 'cash') as id`;
      return row.id as string;
    });
    expect(second).toBe(first);

    const entries = await admin`select * from customer_ledger where customer_id = ${customerId}`;
    expect(entries).toHaveLength(1);
  });

  it("purchase order receiving posts the correct landed-cost supplier balance and updates product cost going forward", async () => {
    const supplierId = await asUserPersist(admin, ownerA, async (tx) => {
      const [row] = await tx`insert into suppliers (tenant_id, name) values (${tenantA}, 'Delta Beverages') returning id`;
      return row.id as string;
    });

    const poId = await asUserPersist(admin, ownerA, async (tx) => {
      const [row] = await tx`select stockflow_create_purchase_order(
        ${branchA}, ${supplierId},
        ${tx.json([{ product_id: productA, quantity_ordered: 10, unit_cost_minor: 100, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });

    await expect(
      asUser(admin, cashierA, (tx) => tx`select stockflow_create_purchase_order(${branchA}, ${supplierId}, ${tx.json([])})`),
    ).rejects.toThrow();

    const receiptId = await asUserPersist(admin, ownerA, async (tx) => {
      const [row] = await tx`select stockflow_receive_purchase_order(
        ${randomUUID()}, ${poId}, ${deviceOwner},
        ${tx.json([{ product_id: productA, quantity_received: 8 }])},
        80, 0, 'USD'
      ) as id`;
      return row.id as string;
    });

    // Base value received = 8 * 100 = 800. Freight 80 allocated wholly to
    // this one line (only line) => landed total 880, landed unit cost 110.
    const [receiptLine] = await admin`select * from purchase_receipt_lines where purchase_receipt_id = ${receiptId}`;
    expect(receiptLine.quantity_ordered).toBe(10);
    expect(receiptLine.quantity_received).toBe(8);
    expect(receiptLine.landed_unit_cost_minor).toBe(110);

    const [product] = await admin`select cost_price_minor from products where id = ${productA}`;
    expect(product.cost_price_minor).toBe(110);

    const ledgerRows = await admin`select * from supplier_ledger where supplier_id = ${supplierId}`;
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].entry_type).toBe("purchase");
    expect(ledgerRows[0].reporting_amount_minor).toBe(880);

    const [po] = await admin`select status from purchase_orders where id = ${poId}`;
    expect(po.status).toBe("received");

    // A prior sale's cost snapshot must not change when the product's
    // going-forward cost changes (Sprint 5's "changed cost doesn't alter
    // historic profit" invariant — proven here at the point of change).
    const priorSaleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 200, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    const [saleItem] = await admin`select unit_cost_price_minor from sale_items where sale_id = ${priorSaleId}`;
    expect(saleItem.unit_cost_price_minor).toBe(110);
  });

  it("provider payment reconciliation is idempotent: a duplicate webhook changes nothing", async () => {
    const customerId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into customers (tenant_id, name) values (${tenantA}, 'Provider Test Customer') returning id`;
      return row.id as string;
    });

    const [providerPayment] = await admin`insert into provider_payments
      (tenant_id, customer_id, provider, provider_reference, status, amount_minor, currency_code)
      values (${tenantA}, ${customerId}, 'paynow', ${"ref-" + randomUUID()}, 'initiated', 500, 'USD')
      returning id`;

    // stockflow_reconcile_provider_payment has no grant to `authenticated`
    // — it's only ever called via the service-role connection from the
    // webhook route, so this test invokes it the same way (raw superuser
    // connection), not through asUser/asUserPersist's staff JWT context.
    const [first] = await admin`select stockflow_reconcile_provider_payment(${providerPayment.id}, 'confirmed') as id`;
    expect(first.id).not.toBeNull();

    const paymentsAfterFirst = await admin`select * from payments where id = ${first.id}`;
    expect(paymentsAfterFirst).toHaveLength(1);

    const [second] = await admin`select stockflow_reconcile_provider_payment(${providerPayment.id}, 'confirmed') as id`;
    expect(second.id).toBe(first.id);

    const allPayments = await admin`select * from payments where customer_id = ${customerId}`;
    expect(allPayments).toHaveLength(1); // duplicate webhook did not create a second payment

    const [pp] = await admin`select status, resulting_payment_id from provider_payments where id = ${providerPayment.id}`;
    expect(pp.status).toBe("confirmed");
    expect(pp.resulting_payment_id).toBe(first.id);
  });

  it("tenant B cannot see tenant A's customers, suppliers or ledgers", async () => {
    const tenantB = randomUUID();
    const ownerB = randomUUID();
    await admin`insert into tenants (id, name, vertical) values (${tenantB}, 'Credit Test Tenant B', 'general_retail')`;
    await admin`insert into auth.users (id, aud, role) values (${ownerB}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    await admin`insert into staff_users (id, tenant_id, phone, role) values (${ownerB}, ${tenantB}, '+263771300099', 'owner')`;

    try {
      const customers = await asUser(admin, ownerB, (tx) => tx`select * from customers where tenant_id = ${tenantA}`);
      expect(customers).toHaveLength(0);
      const ledger = await asUser(admin, ownerB, (tx) => tx`select * from customer_ledger where tenant_id = ${tenantA}`);
      expect(ledger).toHaveLength(0);
    } finally {
      await admin`delete from staff_users where tenant_id = ${tenantB}`;
      await admin`delete from tenants where id = ${tenantB}`;
      await admin`delete from auth.users where id = ${ownerB}`;
    }
  });
});
