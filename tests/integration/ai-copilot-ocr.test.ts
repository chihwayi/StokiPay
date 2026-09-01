import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, asUserPersist } from "./test-helpers";

// Sprint 7's two adversarial acceptance lines from sprints.md:
// "Adversarial tests demonstrate the copilot cannot access another
// tenant or issue writes" and "OCR output is always a draft; no product
// or stock record is created until an owner confirms it." The copilot's
// own tool layer (lib/ai/copilot-tools.ts) always derives tenant_id from
// the caller's own session and never lets the model set it — the tests
// below prove the second, independent layer underneath that: even a
// query that's (hypothetically) scoped to the wrong tenant_id still
// returns nothing, because RLS restricts every row to the authenticated
// user's own tenant regardless of what a WHERE clause asks for.

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Sprint 7: copilot tenant isolation and OCR draft immutability", () => {
  const admin = postgres(connectionString ?? "", { ssl: false });

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const ownerA = randomUUID();
  const cashierA = randomUUID();
  const ownerB = randomUUID();
  const deviceOwnerA = randomUUID();
  const deviceCashierA = randomUUID();
  const deviceOwnerB = randomUUID();
  const productB = randomUUID();
  const customerB = randomUUID();

  beforeAll(async () => {
    await admin`insert into tenants (id, name, vertical, reporting_currency) values
      (${tenantA}, 'Copilot Test Tenant A', 'general_retail', 'USD'),
      (${tenantB}, 'Copilot Test Tenant B', 'general_retail', 'USD')`;
    await admin`insert into branches (id, tenant_id, name, is_primary) values
      (${branchA}, ${tenantA}, 'Branch A', true),
      (${branchB}, ${tenantB}, 'Branch B', true)`;
    for (const id of [ownerA, cashierA, ownerB]) {
      await admin`insert into auth.users (id, aud, role) values (${id}, 'authenticated', 'authenticated') on conflict (id) do nothing`;
    }
    await admin`insert into staff_users (id, tenant_id, branch_id, phone, role) values
      (${ownerA}, ${tenantA}, ${branchA}, '+263771500001', 'owner'),
      (${cashierA}, ${tenantA}, ${branchA}, '+263771500002', 'cashier'),
      (${ownerB}, ${tenantB}, ${branchB}, '+263771500003', 'owner')`;
    await admin`insert into devices (id, tenant_id, staff_user_id) values
      (${deviceOwnerA}, ${tenantA}, ${ownerA}),
      (${deviceCashierA}, ${tenantA}, ${cashierA}),
      (${deviceOwnerB}, ${tenantB}, ${ownerB})`;
    await admin`insert into products (id, tenant_id, name, cost_price_minor, sell_price_minor, price_currency) values
      (${productB}, ${tenantB}, 'Tenant B Secret Product', 100, 200, 'USD')`;
    await admin`insert into customers (id, tenant_id, name) values (${customerB}, ${tenantB}, 'Tenant B Debtor')`;
    await admin`insert into customer_ledger (tenant_id, customer_id, entry_type, currency_code, amount_minor, exchange_rate_snapshot, reporting_currency_code, reporting_amount_minor, rate_source, actor_staff_user_id, device_id, operation_id) values
      (${tenantB}, ${customerB}, 'credit_sale', 'USD', 5000, 1, 'USD', 5000, 'identity', ${ownerB}, ${deviceOwnerB}, ${randomUUID()})`;
  });

  afterAll(async () => {
    await admin`delete from alerts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from ocr_drafts where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customer_ledger where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from customers where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from stock_movements where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from products where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from devices where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from staff_users where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from branches where tenant_id in (${tenantA}, ${tenantB})`;
    await admin`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await admin`delete from auth.users where id in (${ownerA}, ${cashierA}, ${ownerB})`;
    await admin.end();
  });

  it("a copilot tool query scoped to another tenant's id returns nothing (RLS, not query trust)", async () => {
    // Mirrors exactly what lib/ai/copilot-tools.ts's get_debt_summary does:
    // .from('customer_ledger').eq('tenant_id', ctx.tenantId). Here the
    // session is tenant A's owner but the filter (as if the tool's tenant
    // scope were somehow tenant B) asks for tenant B's rows.
    const rows = await asUser(admin, ownerA, (tx) =>
      tx`select * from customer_ledger where tenant_id = ${tenantB}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("a copilot tool product-sales query scoped to another tenant returns nothing", async () => {
    const rows = await asUser(admin, ownerA, (tx) => tx`select * from products where tenant_id = ${tenantB}`);
    expect(rows).toHaveLength(0);
  });

  it("no session-authenticated role can call the anomaly scan RPC directly (service_role only)", async () => {
    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_run_anomaly_scan(${tenantA})`),
    ).rejects.toThrow();
  });

  it("uploading an OCR draft claiming another staff member as uploader is rejected", async () => {
    await expect(
      asUser(admin, ownerA, (tx) =>
        tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
          (${tenantA}, ${branchA}, ${cashierA}, ${deviceOwnerA}, '[]'::jsonb, 'draft')`,
      ),
    ).rejects.toThrow();
  });

  it("uploading an OCR draft with another tenant's device is rejected", async () => {
    await expect(
      asUser(admin, ownerA, (tx) =>
        tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
          (${tenantA}, ${branchA}, ${ownerA}, ${deviceOwnerB}, '[]'::jsonb, 'draft')`,
      ),
    ).rejects.toThrow();
  });

  it("a cashier cannot confirm or reject an OCR draft (owner/manager only)", async () => {
    const draftId = await asUserPersist(admin, cashierA, async (tx) => {
      const [row] = await tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
        (${tenantA}, ${branchA}, ${cashierA}, ${deviceCashierA}, '[]'::jsonb, 'draft') returning id`;
      return row.id as string;
    });

    await expect(
      asUser(admin, cashierA, (tx) =>
        tx`select stockflow_confirm_ocr_draft(${draftId}, ${deviceCashierA}, '[]'::jsonb)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(admin, cashierA, (tx) => tx`select stockflow_reject_ocr_draft(${draftId})`),
    ).rejects.toThrow();
  });

  it("confirming a draft creates products/stock only from the owner-reviewed lines, never the raw extraction", async () => {
    const draftId = await asUserPersist(admin, ownerA, async (tx) => {
      const [row] = await tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
        (${tenantA}, ${branchA}, ${ownerA}, ${deviceOwnerA}, ${tx.json([{ productName: "Misread Item", quantity: 999, unitPriceMinor: null, confidence: "low" }])}, 'draft') returning id`;
      return row.id as string;
    });

    const correctedLines = [{ product_name: "Cooking Oil 2L", quantity: 12, unit_cost_minor: 150, sell_price_minor: 250, currency_code: "USD" }];
    const [result] = await asUserPersist(admin, ownerA, (tx) =>
      tx`select stockflow_confirm_ocr_draft(${draftId}, ${deviceOwnerA}, ${tx.json(correctedLines)}) as result`,
    );
    const createdProductIds: string[] = result.result.created_product_ids;
    expect(createdProductIds).toHaveLength(1);

    const [product] = await admin`select name from products where id = ${createdProductIds[0]}`;
    expect(product.name).toBe("Cooking Oil 2L");
    expect(product.name).not.toBe("Misread Item");

    const [movement] = await admin`select quantity_delta, movement_type from stock_movements where product_id = ${createdProductIds[0]}`;
    expect(movement.movement_type).toBe("receipt");
    expect(movement.quantity_delta).toBe(12);

    await admin`delete from stock_movements where product_id = ${createdProductIds[0]}`;
    await admin`delete from products where id = ${createdProductIds[0]}`;
  });

  it("a confirmed draft cannot be confirmed again (draft-immutability)", async () => {
    const draftId = await asUserPersist(admin, ownerA, async (tx) => {
      const [row] = await tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
        (${tenantA}, ${branchA}, ${ownerA}, ${deviceOwnerA}, '[]'::jsonb, 'draft') returning id`;
      return row.id as string;
    });

    const emptyLines: { product_name: string; quantity: number }[] = [];
    await asUserPersist(admin, ownerA, (tx) =>
      tx`select stockflow_confirm_ocr_draft(${draftId}, ${deviceOwnerA}, ${tx.json(emptyLines)})`,
    );

    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_confirm_ocr_draft(${draftId}, ${deviceOwnerA}, ${tx.json(emptyLines)})`),
    ).rejects.toThrow();
    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_reject_ocr_draft(${draftId})`),
    ).rejects.toThrow();
  });

  it("a rejected draft cannot later be confirmed", async () => {
    const draftId = await asUserPersist(admin, ownerA, async (tx) => {
      const [row] = await tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
        (${tenantA}, ${branchA}, ${ownerA}, ${deviceOwnerA}, '[]'::jsonb, 'draft') returning id`;
      return row.id as string;
    });

    await asUserPersist(admin, ownerA, (tx) => tx`select stockflow_reject_ocr_draft(${draftId})`);

    const emptyLines: { product_name: string; quantity: number }[] = [];
    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_confirm_ocr_draft(${draftId}, ${deviceOwnerA}, ${tx.json(emptyLines)})`),
    ).rejects.toThrow();
  });

  it("tenant A cannot see or act on tenant B's OCR draft", async () => {
    const draftIdB = await asUserPersist(admin, ownerB, async (tx) => {
      const [row] = await tx`insert into ocr_drafts (tenant_id, branch_id, uploaded_by, device_id, extracted_lines, status) values
        (${tenantB}, ${branchB}, ${ownerB}, ${deviceOwnerB}, '[]'::jsonb, 'draft') returning id`;
      return row.id as string;
    });

    const rows = await asUser(admin, ownerA, (tx) => tx`select * from ocr_drafts where id = ${draftIdB}`);
    expect(rows).toHaveLength(0);

    const emptyLines: { product_name: string; quantity: number }[] = [];
    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_confirm_ocr_draft(${draftIdB}, ${deviceOwnerA}, ${tx.json(emptyLines)})`),
    ).rejects.toThrow();

    await admin`delete from ocr_drafts where id = ${draftIdB}`;
  });

  it("dismissing an alert twice fails the second time (no double-dismiss)", async () => {
    const [alert] = await admin`insert into alerts (tenant_id, alert_type, message) values
      (${tenantA}, 'unresolved_stock_conflict', 'test alert') returning id`;

    await asUserPersist(admin, ownerA, (tx) => tx`select stockflow_dismiss_alert(${alert.id})`);
    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_dismiss_alert(${alert.id})`),
    ).rejects.toThrow();

    await admin`delete from alerts where id = ${alert.id}`;
  });

  it("tenant A cannot dismiss tenant B's alert", async () => {
    const [alert] = await admin`insert into alerts (tenant_id, alert_type, message) values
      (${tenantB}, 'unresolved_stock_conflict', 'tenant b alert') returning id`;

    await expect(
      asUser(admin, ownerA, (tx) => tx`select stockflow_dismiss_alert(${alert.id})`),
    ).rejects.toThrow();

    const [row] = await admin`select dismissed from alerts where id = ${alert.id}`;
    expect(row.dismissed).toBe(false);

    await admin`delete from alerts where id = ${alert.id}`;
  });
});
