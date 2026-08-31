import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aggregateProfitReport, computeDebtSummary } from "@/lib/domain/reports";
import { asUserPersist } from "./test-helpers";

// Proves Sprint 5's core acceptance criteria against real database rows
// (not just the pure lib/domain/reports.ts unit tests): a changed
// product cost does not alter historic profit, reports use the sale's
// own stored rate snapshot rather than a later exchange rate, and a
// debt report reconciles to the underlying customer_ledger.

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Reports: profit immutability, snapshot rates, reconciliation", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const branchA = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const deviceOwner = randomUUID();
  const deviceCashier = randomUUID();
  const productA = randomUUID();

  beforeAll(async () => {
    await admin`insert into tenants (id, name, vertical, reporting_currency) values (${tenantA}, 'Reports Test Tenant', 'general_retail', 'USD')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values (${branchA}, ${tenantA}, 'Main', true)`;
    for (const id of [ownerA, cashierA]) {
      await admin`insert into auth.users (id, aud, role) values (${id}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    }
    await admin`insert into staff_users (id, tenant_id, branch_id, phone, role) values
      (${ownerA}, ${tenantA}, ${branchA}, '+263771400001', 'owner'),
      (${cashierA}, ${tenantA}, ${branchA}, '+263771400002', 'cashier')`;
    await admin`insert into devices (id, tenant_id, staff_user_id) values
      (${deviceOwner}, ${tenantA}, ${ownerA}),
      (${deviceCashier}, ${tenantA}, ${cashierA})`;
    await admin`insert into products (id, tenant_id, name, cost_price_minor, sell_price_minor, price_currency) values
      (${productA}, ${tenantA}, 'Bread Loaf', 100, 200, 'USD')`;
    await admin`insert into stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_delta, actor_staff_user_id, device_id, operation_id) values
      (${tenantA}, ${branchA}, ${productA}, 'receipt', 50, ${ownerA}, ${deviceOwner}, ${randomUUID()})`;
  });

  afterAll(async () => {
    await admin`delete from customer_ledger where tenant_id = ${tenantA}`;
    await admin`delete from payments where tenant_id = ${tenantA}`;
    await admin`delete from sale_items where tenant_id = ${tenantA}`;
    await admin`delete from sales where tenant_id = ${tenantA}`;
    await admin`delete from customers where tenant_id = ${tenantA}`;
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

  it("a changed product cost does not alter a historic sale's profit", async () => {
    // Sale happens while product cost is 100.
    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 3, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 600, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });

    const itemsBefore = await admin`select quantity, unit_price_minor, unit_cost_price_minor from sale_items where sale_id = ${saleId}`;
    const reportBefore = aggregateProfitReport(
      itemsBefore.map((i) => ({
        quantity: i.quantity,
        unitPriceMinor: i.unit_price_minor,
        unitCostPriceMinor: i.unit_cost_price_minor,
        saleExchangeRateSnapshot: 1,
      })),
    );
    expect(reportBefore.profitMinor).toBe(300); // (200-100) * 3

    // Product cost changes later (e.g. a Sprint 4 purchase-order receipt).
    await admin`update products set cost_price_minor = 175 where id = ${productA}`;

    const itemsAfter = await admin`select quantity, unit_price_minor, unit_cost_price_minor from sale_items where sale_id = ${saleId}`;
    const reportAfter = aggregateProfitReport(
      itemsAfter.map((i) => ({
        quantity: i.quantity,
        unitPriceMinor: i.unit_price_minor,
        unitCostPriceMinor: i.unit_cost_price_minor,
        saleExchangeRateSnapshot: 1,
      })),
    );
    expect(reportAfter).toEqual(reportBefore);
    expect(reportAfter.profitMinor).toBe(300);
  });

  it("a report uses the sale's own stored rate snapshot, not a rate approved after the sale", async () => {
    await admin`insert into exchange_rates (tenant_id, base_currency, quote_currency, rate, source, approved_by) values
      (${tenantA}, 'ZAR', 'USD', 0.05, 'manual', ${ownerA})`;

    const saleId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`select stockflow_create_sale(
        ${randomUUID()}, ${branchA}, ${deviceCashier}, 'USD',
        ${tx.json([{ product_id: productA, quantity: 1, unit_price_minor: 200 }])},
        ${tx.json([{ tender_type: "cash", amount_minor: 200, currency_code: "USD" }])}
      ) as id`;
      return row.id as string;
    });
    const [sale] = await admin`select exchange_rate_snapshot from sales where id = ${saleId}`;
    const rateAtSaleTime = Number(sale.exchange_rate_snapshot);
    expect(rateAtSaleTime).toBe(1); // sale currency == reporting currency here, identity rate

    // A new, different rate gets approved after the sale — must not
    // retroactively change what the sale's own snapshot says.
    await admin`insert into exchange_rates (tenant_id, base_currency, quote_currency, rate, source, approved_by) values
      (${tenantA}, 'ZAR', 'USD', 0.09, 'manual', ${ownerA})`;

    const [saleAfterNewRate] = await admin`select exchange_rate_snapshot from sales where id = ${saleId}`;
    expect(Number(saleAfterNewRate.exchange_rate_snapshot)).toBe(rateAtSaleTime);
  });

  it("a debt report reconciles exactly to the underlying customer_ledger", async () => {
    const customerId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into customers (tenant_id, name) values (${tenantA}, 'Reports Test Customer') returning id`;
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
    await asUserPersist(admin, cashierA, (tx) =>
      tx`select stockflow_record_customer_payment(${randomUUID()}, ${customerId}, ${deviceCashier}, 150, 'USD', 'cash')`,
    );

    const ledgerRows = await admin`select reporting_amount_minor from customer_ledger where customer_id = ${customerId}`;
    const { rows, totalOutstandingMinor } = computeDebtSummary(
      ledgerRows.map((r) => ({ customerId, reportingAmountMinor: r.reporting_amount_minor })),
    );

    const rawBalance = ledgerRows.reduce((s, r) => s + r.reporting_amount_minor, 0);
    expect(rows[0].balanceMinor).toBe(rawBalance);
    expect(totalOutstandingMinor).toBe(rawBalance);
    expect(rawBalance).toBe(250); // 400 owed - 150 paid
  });
});
