import { getPowerSyncDb } from "./db";
import { getOrCreateDeviceId } from "./device-id";
import { createOperationId } from "./operation-id";

// Local-first write adapters (ADR 0002/0003). Every function here writes
// only to a local SQLite table via the PowerSync client — it returns as
// soon as the local write commits, works fully offline, and survives a
// refresh (PowerSync persists to IndexedDB). The actual server-side
// commit (rate resolution, idempotent replay, atomic multi-row insert)
// happens later in lib/sync/connector.ts's uploadData(), automatically,
// whenever connectivity allows.

export type SaleItemInput = {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
};

export type SalePaymentInput = {
  tenderType: "cash" | "mobile_money" | "card" | "bank_transfer";
  amountMinor: number;
  currencyCode: string;
};

export async function queueSale(params: {
  branchId: string;
  currencyCode: string;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
}): Promise<{ operationId: string }> {
  const deviceId = getOrCreateDeviceId();
  const operationId = createOperationId();
  const db = getPowerSyncDb();

  await db.execute(
    `insert into pending_sales
      (id, operation_id, branch_id, device_id, currency_code, items_json, payments_json, created_at)
      values (uuid(), ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      operationId,
      params.branchId,
      deviceId,
      params.currencyCode,
      JSON.stringify(
        params.items.map((i) => ({
          product_id: i.productId,
          quantity: i.quantity,
          unit_price_minor: i.unitPriceMinor,
        })),
      ),
      JSON.stringify(
        params.payments.map((p) => ({
          tender_type: p.tenderType,
          amount_minor: p.amountMinor,
          currency_code: p.currencyCode,
        })),
      ),
    ],
  );

  return { operationId };
}

export type ReturnItemInput = {
  saleItemId: string;
  quantity: number;
};

export async function queueReturn(params: {
  originalSaleId: string;
  reason: string;
  refundTenderType: "cash" | "mobile_money" | "card" | "bank_transfer";
  items: ReturnItemInput[];
}): Promise<{ operationId: string }> {
  const deviceId = getOrCreateDeviceId();
  const operationId = createOperationId();
  const db = getPowerSyncDb();

  await db.execute(
    `insert into pending_returns
      (id, operation_id, original_sale_id, device_id, reason, refund_tender_type, items_json, created_at)
      values (uuid(), ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      operationId,
      params.originalSaleId,
      deviceId,
      params.reason,
      params.refundTenderType,
      JSON.stringify(
        params.items.map((i) => ({ sale_item_id: i.saleItemId, quantity: i.quantity })),
      ),
    ],
  );

  return { operationId };
}

export async function queueStockMovement(params: {
  tenantId: string;
  branchId: string;
  productId: string;
  movementType: "receipt" | "adjustment";
  quantityDelta: number;
  reason?: string;
}): Promise<{ operationId: string }> {
  const deviceId = getOrCreateDeviceId();
  const operationId = createOperationId();
  const db = getPowerSyncDb();

  await db.execute(
    `insert into pending_stock_movements
      (id, operation_id, tenant_id, branch_id, product_id, movement_type, quantity_delta, reason, device_id, created_at)
      values (uuid(), ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      operationId,
      params.tenantId,
      params.branchId,
      params.productId,
      params.movementType,
      params.quantityDelta,
      params.reason ?? null,
      deviceId,
    ],
  );

  return { operationId };
}
