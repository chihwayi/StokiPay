import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserPersist } from "./test-helpers";

// Proves Sprint 3's core accounting-truth acceptance criteria
// (sprints.md): atomic split-tender sale creation, idempotent replay,
// returns that reverse without mutating the original sale, and cash-up
// variance/review flow.

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Sales, returns, cash-up", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const branchA = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const deviceOwner = randomUUID();
  const deviceCashier = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();

  beforeAll(async () => {
    await admin`insert into tenants (id, name, vertical, reporting_currency) values (${tenantA}, 'Sales Test Tenant', 'general_retail', 'USD')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values (${branchA}, ${tenantA}, 'Main', true)`;
    for (const id of [ownerA, cashierA]) {
      await admin`insert into auth.users (id, aud, role) values (${id}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    }
    await admin`insert into staff_users (id, tenant_id, phone, role) values
      (${ownerA}, ${tenantA}, '+263771200001', 'owner'),
      (${cashierA}, ${tenantA}, '+263771200002', 'cashier')`;
    await admin`insert into devices (id, tenant_id, staff_user_id) values
      (${deviceOwner}, ${tenantA}, ${ownerA}),
      (${deviceCashier}, ${tenantA}, ${cashierA})`;
    await admin`insert into products (id, tenant_id, name, cost_price_minor, sell_price_minor, price_currency) values
      (${productA}, ${tenantA}, 'Bread Loaf', 100, 200, 'USD'),
      (${productB}, ${tenantA}, 'Cooking Oil 2L', 300, 500, 'USD')`;
    await admin`insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id) values
      (${tenantA}, ${branchA}, ${productA}, 'receipt', 50, ${ownerA}, ${deviceOwner}, ${randomUUID()}),
      (${tenantA}, ${branchA}, ${productB}, 'receipt', 50, ${ownerA}, ${deviceOwner}, ${randomUUID()})`;
    // ZAR->USD approved rate, needed for split-tender-in-a-different-currency tests.
    await admin`insert into exchange_rates (tenant_id, base_currency, quote_currency, rate, source, approved_by) values
      (${tenantA}, 'ZAR', 'USD', 0.055, 'manual', ${ownerA})`;
  });

  afterAll(async () => {
    await admin`delete from cash_variances where tenant_id = ${tenantA}`;
    await admin`delete from cash_counts where tenant_id = ${tenantA}`;
    await admin`delete from payments where tenant_id = ${tenantA}`;
    await admin`delete from return_items where tenant_id = ${tenantA}`;
    await admin`delete from returns where tenant_id = ${tenantA}`;
    await admin`delete from sale_items where tenant_id = ${tenantA}`;
    await admin`delete from sales where tenant_id = ${tenantA}`;
    await admin`delete from cash_sessions where tenant_id = ${tenantA}`;
    await admin`delete from stock_movements where tenant_id = ${tenantA}`;
    await admin`delete from products where tenant_id = ${tenantA}`;
    await admin`delete from exchange_rates where tenant_id = ${tenantA}`;
    await admin`delete from devices where tenant_id = ${tenantA}`;
    await admin`delete from staff_users where tenant_id = ${tenantA}`;
    await admin`delete from branches where tenant_id = ${tenantA}`;
    await admin`delete from tenants where id = ${tenantA}`;
    await admin`delete from auth.users where id in (${ownerA}, ${cashierA})`;
    await admin.end();
  });

  it("creates a three-line split cash/mobile-money sale atomically", async () => {
    const opId = randomUUID();
    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${opId}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([
          { product_id: productA, quantity: 2, unit_price_minor: 200 },
          { product_id: productB, quantity: 1, unit_price_minor: 500 },
          { product_id: productA, quantity: 1, unit_price_minor: 200 },
        ])},
        ${tx.json([
          { tender_type: "cash", amount_minor: 600, currency_code: "USD" },
          { tender_type: "mobile_money", amount_minor: 500, currency_code: "USD" },
        ])}
      ) as id`;
      return row.id as string;
    });

    const [sale] = await admin`select * from sales where id = ${saleId}`;
    expect(sale.amount_minor).toBe(1100);
    expect(sale.reporting_amount_minor).toBe(1100);

    const items = await admin`select * from sale_items where sale_id = ${saleId} order by unit_price_minor`;
    expect(items).toHaveLength(3);

    const pays = await admin`select * from payments where sale_id = ${saleId} and direction = 'in'`;
    expect(pays).toHaveLength(2);
    expect(pays.reduce((s, p) => s + p.reporting_amount_minor, 0)).toBe(1100);

    const movements = await admin`select * from stock_movements where tenant_id = ${tenantA} and movement_type = 'sale'`;
    expect(movements).toHaveLength(3);
    expect(movements.reduce((s, m) => s + m.quantity_delta, 0)).toBe(-4);
  });

  it("replaying the same operation ID creates one sale only", async () => {
    const opId = randomUUID();
    const items = [{ product_id: productA, quantity: 1, unit_price_minor: 200 }];
    const pays = [{ tender_type: "cash", amount_minor: 200, currency_code: "USD" }];

    const firstId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${opId}, ${branchA}, ${deviceCashier}, 'USD', ${tx.json(items)}, ${tx.json(pays)}
      ) as id`;
      return row.id as string;
    });
    const secondId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${opId}, ${branchA}, ${deviceCashier}, 'USD', ${tx.json(items)}, ${tx.json(pays)}
      ) as id`;
      return row.id as string;
    });

    expect(secondId).toBe(firstId);
    const sales = await admin`select * from sales where operation_id = ${opId}`;
    expect(sales).toHaveLength(1);
  });

  it("a forced failure (payments don't cover the total) leaves no partial sale/items/payments/movements", async () => {
    const opId = randomUUID();
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`select stockflow_create_sale(
          ${opId}, ${branchA}, ${deviceCashier}, 'USD',
          ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 200 }])},
          ${tx.json([{ tender_type: "cash", amount_minor: 50, currency_code: "USD" }])}
        )`,
      ),
    ).rejects.toThrow();

    const sales = await admin`select * from sales where operation_id = ${opId}`;
    expect(sales).toHaveLength(0);
  });

  it("cannot create a sale on a device that isn't yours", async () => {
    const opId = randomUUID();
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`select stockflow_create_sale(
          ${opId}, ${branchA}, ${deviceOwner}, 'USD',
          ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 200 }])},
          ${tx.json([{ tender_type: "cash", amount_minor: 200, currency_code: "USD" }])}
        )`,
      ),
    ).rejects.toThrow();
  });

  it("supports split tender in a different currency using the approved exchange rate", async () => {
    const opId = randomUUID();
    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${opId}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 5, unit_price_minor: 200 }])},
        ${tx.json([
          { tender_type: "cash", amount_minor: 500, currency_code: "USD" },
          { tender_type: "cash", amount_minor: 9091, currency_code: "ZAR" },
        ])}
      ) as id`;
      return row.id as string;
    });
    const pays = await admin`select * from payments where sale_id = ${saleId} order by currency_code`;
    const zar = pays.find((p) => p.currency_code === "ZAR");
    expect(zar).toBeTruthy();
    expect(Number(zar!.exchange_rate_snapshot)).toBeCloseTo(0.055, 6);
    expect(zar!.reporting_amount_minor).toBe(Math.round(9091 * 0.055));
  });

  it("a return creates linked reversal records and never mutates the original sale", async () => {
    const saleOpId = randomUUID();
    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${saleOpId}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 3, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 600, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    const [originalSaleBefore] = await admin`select * from sales where id = ${saleId}`;
    const [saleItem] = await admin`select * from sale_items where sale_id = ${saleId}`;

    const returnOpId = randomUUID();
    const returnId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_return(
        ${returnOpId}, ${saleId}, ${deviceCashier}, 'customer changed mind', 'cash',
        ${tx.json([{ sale_item_id: saleItem.id, quantity: 1 }])}
      ) as id`;
      return row.id as string;
    });

    const [originalSaleAfter] = await admin`select * from sales where id = ${saleId}`;
    expect(originalSaleAfter).toEqual(originalSaleBefore);

    const [ret] = await admin`select * from returns where id = ${returnId}`;
    expect(ret.original_sale_id).toBe(saleId);

    const returnItems = await admin`select * from return_items where return_id = ${returnId}`;
    expect(returnItems).toHaveLength(1);
    expect(returnItems[0].quantity).toBe(1);

    const restock = await admin`select * from stock_movements where tenant_id = ${tenantA} and movement_type = 'return' and reason like ${"%" + returnId + "%"}`;
    expect(restock).toHaveLength(1);
    expect(restock[0].quantity_delta).toBe(1);

    const refund = await admin`select * from payments where return_id = ${returnId}`;
    expect(refund).toHaveLength(1);
    expect(refund[0].direction).toBe("out");
    expect(refund[0].amount_minor).toBe(200);
  });

  it("a return without a reason is rejected", async () => {
    const saleOpId = randomUUID();
    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${saleOpId}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 200, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    const [saleItem] = await admin`select * from sale_items where sale_id = ${saleId}`;

    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`select stockflow_create_return(
          ${randomUUID()}, ${saleId}, ${deviceCashier}, '', 'cash',
          ${tx.json([{ sale_item_id: saleItem.id, quantity: 1 }])}
        )`,
      ),
    ).rejects.toThrow();
  });

  it("cannot return more units than were sold, even across multiple partial returns", async () => {
    const saleOpId = randomUUID();
    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${saleOpId}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 2, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 400, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    const [saleItem] = await admin`select * from sale_items where sale_id = ${saleId}`;

    // First partial return of 1 unit succeeds.
    await asUserPersist(admin, cashierA, (tx) =>
      tx`select stockflow_create_return(
        ${randomUUID()}, ${saleId}, ${deviceCashier}, 'first partial return', 'cash',
        ${tx.json([{ sale_item_id: saleItem.id, quantity: 1 }])}
      )`,
    );

    // A second return of 2 more units would exceed the 2 originally sold
    // (1 already returned + 2 requested > 2 sold) — must be rejected.
    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`select stockflow_create_return(
          ${randomUUID()}, ${saleId}, ${deviceCashier}, 'second return attempt', 'cash',
          ${tx.json([{ sale_item_id: saleItem.id, quantity: 2 }])}
        )`,
      ),
    ).rejects.toThrow();

    const returned = await admin`select coalesce(sum(quantity), 0) as total from return_items where sale_item_id = ${saleItem.id}`;
    expect(Number(returned[0].total)).toBe(1);
  });

  it("cash-up: opens a session, sells within it, closes with a matching count and no variance", async () => {
    const sessionId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into cash_sessions
        (tenant_id, branch_id, device_id, opened_by, opening_float_minor, opening_currency, status)
        values (${tenantA}, ${branchA}, ${deviceCashier}, ${cashierA}, 5000, 'USD', 'open')
        returning id`;
      return row.id as string;
    });

    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 200, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    expect(saleId).toBeTruthy();

    await asUserPersist(admin, cashierA, (tx) =>
      tx`select stockflow_close_cash_session(
        ${sessionId},
        ${tx.json([{ tender_type: "cash", currency_code: "USD", counted_amount_minor: 5200 }])}
      )`,
    );

    const [variance] = await admin`select * from cash_variances where cash_session_id = ${sessionId}`;
    expect(variance.expected_amount_minor).toBe(5200);
    expect(variance.variance_minor).toBe(0);
    expect(variance.requires_review).toBe(false);

    const [session] = await admin`select * from cash_sessions where id = ${sessionId}`;
    expect(session.status).toBe("closed");
  });

  it("cash-up: a variance beyond the threshold requires a reason and manager review", async () => {
    const sessionId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into cash_sessions
        (tenant_id, branch_id, device_id, opened_by, opening_float_minor, opening_currency, status)
        values (${tenantA}, ${branchA}, ${deviceCashier}, ${cashierA}, 0, 'USD', 'open')
        returning id`;
      return row.id as string;
    });

    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`select stockflow_close_cash_session(
          ${sessionId},
          ${tx.json([{ tender_type: "cash", currency_code: "USD", counted_amount_minor: 10000 }])}
        )`,
      ),
    ).rejects.toThrow();

    const varianceId = await asUserPersist(admin, cashierA, async (tx) => {
      await tx`select stockflow_close_cash_session(
        ${sessionId},
        ${tx.json([{ tender_type: "cash", currency_code: "USD", counted_amount_minor: 10000, reason: "till float miscounted at open" }])}
      )`;
      const [row] = await tx`select id from cash_variances where cash_session_id = ${sessionId}`;
      return row.id as string;
    });

    const [variance] = await admin`select * from cash_variances where id = ${varianceId}`;
    expect(variance.requires_review).toBe(true);
    expect(variance.reviewed_at).toBeNull();

    await expect(
      asUser(admin, cashierA, (tx) => tx`select stockflow_review_cash_variance(${varianceId})`),
    ).rejects.toThrow();

    await asUserPersist(admin, ownerA, (tx) => tx`select stockflow_review_cash_variance(${varianceId})`);
    const [reviewed] = await admin`select * from cash_variances where id = ${varianceId}`;
    expect(reviewed.reviewed_by).toBe(ownerA);
    expect(reviewed.reviewed_at).not.toBeNull();
  });

  it("tenant B cannot see tenant A's sales, payments or returns", async () => {
    const tenantB = randomUUID();
    const ownerB = randomUUID();
    await admin`insert into tenants (id, name, vertical) values (${tenantB}, 'Sales Test Tenant B', 'general_retail')`;
    await admin`insert into auth.users (id, aud, role) values (${ownerB}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    await admin`insert into staff_users (id, tenant_id, phone, role) values (${ownerB}, ${tenantB}, '+263771200099', 'owner')`;

    try {
      const rows = await asUser(admin, ownerB, (tx) => tx`select * from sales where tenant_id = ${tenantA}`);
      expect(rows).toHaveLength(0);
    } finally {
      await admin`delete from staff_users where tenant_id = ${tenantB}`;
      await admin`delete from tenants where id = ${tenantB}`;
      await admin`delete from auth.users where id = ${ownerB}`;
    }
  });
});
