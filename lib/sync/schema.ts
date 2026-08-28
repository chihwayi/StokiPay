import { column, Schema, Table } from "@powersync/web";

// PowerSync local (SQLite) schema. Mirrors infra/powersync/sync_rules.yaml
// for the read-side tables (synced down, tenant-scoped by the sync rules
// themselves — never trust a client-side filter alone) and adds
// local write-queue tables for every offline-safe write path (ADR 0002,
// ADR 0003). PowerSync columns are text/integer/real only; jsonb RPC
// payloads are stored as JSON-encoded text and parsed in
// lib/sync/connector.ts's uploadData().

const tenants = new Table({
  name: column.text,
  vertical: column.text,
  reporting_currency: column.text,
});

const branches = new Table({
  tenant_id: column.text,
  name: column.text,
  is_primary: column.integer,
});

const staffUsers = new Table({
  tenant_id: column.text,
  branch_id: column.text,
  phone: column.text,
  display_name: column.text,
  role: column.text,
  is_active: column.integer,
});

const devices = new Table({
  tenant_id: column.text,
  staff_user_id: column.text,
  device_label: column.text,
});

const products = new Table({
  tenant_id: column.text,
  name: column.text,
  category: column.text,
  unit: column.text,
  barcode: column.text,
  cost_price_minor: column.integer,
  sell_price_minor: column.integer,
  price_currency: column.text,
  low_stock_threshold: column.integer,
  is_active: column.integer,
});

const stockMovements = new Table({
  tenant_id: column.text,
  branch_id: column.text,
  product_id: column.text,
  movement_type: column.text,
  quantity_delta: column.integer,
  reason: column.text,
  operation_id: column.text,
  created_at: column.text,
});

// Local write-queue tables. Each row is one client-committed action,
// keyed by its own operation_id (ADR 0003) so a row is never re-queued
// twice even if this table itself gets re-synced. args_json carries the
// exact RPC parameters, resolved entirely client-side at commit time
// (product prices, quantities, tender split) — the server RPC is still
// the authority for rate lookups, idempotency and totals validation.
const pendingSales = new Table({
  operation_id: column.text,
  branch_id: column.text,
  device_id: column.text,
  currency_code: column.text,
  items_json: column.text,
  payments_json: column.text,
  customer_id: column.text, // credit sale (Sprint 4) — null for a fully-paid sale
  created_at: column.text,
});

const pendingReturns = new Table({
  operation_id: column.text,
  original_sale_id: column.text,
  device_id: column.text,
  reason: column.text,
  refund_tender_type: column.text,
  items_json: column.text,
  created_at: column.text,
});

const pendingStockMovements = new Table({
  operation_id: column.text,
  tenant_id: column.text,
  branch_id: column.text,
  product_id: column.text,
  movement_type: column.text,
  quantity_delta: column.integer,
  reason: column.text,
  device_id: column.text,
  created_at: column.text,
});

export const AppSchema = new Schema({
  tenants,
  branches,
  staff_users: staffUsers,
  devices,
  products,
  stock_movements: stockMovements,
  pending_sales: pendingSales,
  pending_returns: pendingReturns,
  pending_stock_movements: pendingStockMovements,
});

export type Database = (typeof AppSchema)["types"];
