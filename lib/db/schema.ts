import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Sprint 1 — Identity, Tenants & Authorisation. Every tenant-owned table
// carries tenant_id and has RLS policies applied in
// lib/db/migrations/0001_rls_policies.sql (hand-written — Drizzle's schema
// API doesn't express the auth.uid()-based policies these tables need).
// See docs/adr/0001 (hosting), docs/runbooks/coolify-deployment.md
// (RLS boundary rules).

export const staffRole = pgEnum("staff_role", ["owner", "manager", "cashier"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  vertical: text("vertical").notNull(), // 'general_retail' | 'bottle_store' — launch verticals per sprints.md
  reportingCurrency: text("reporting_currency").notNull().default("USD"), // ZIG | USD | ZAR
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// id matches the GoTrue auth.users.id for this staff member (1 auth user
// == 1 staff_user row, scoped to exactly one tenant).
export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id").references(() => branches.id),
  phone: text("phone").notNull(),
  displayName: text("display_name"),
  role: staffRole("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  staffUserId: uuid("staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  deviceLabel: text("device_label"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only accounting/accountability trail (CLAUDE.md rule 2) — no
// update or delete policy is ever granted on this table.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  actorStaffUserId: uuid("actor_staff_user_id").references(() => staffUsers.id),
  deviceId: uuid("device_id").references(() => devices.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sprint 2 — Product, Stock & Inventory Controls. stock_levels is
// deliberately NOT a table here — it's a derived view
// (lib/db/migrations/0005_products_and_stock.sql) over stock_movements,
// so "stock on hand" can never drift from its movement history
// (sprints.md's reconciliation acceptance criterion).

export const products = pgTable("products", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  category: text("category"),
  unit: text("unit").notNull().default("each"),
  barcode: text("barcode"),
  costPriceMinor: integer("cost_price_minor").notNull().default(0),
  sellPriceMinor: integer("sell_price_minor").notNull().default(0),
  priceCurrency: text("price_currency").notNull().default("USD"), // ZIG | USD | ZAR
  lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only (CLAUDE.md rule 2/3) — every stock change is a row here,
// never an edit to a running total. operation_id/device_id are the
// idempotency contract from ADR 0003.
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  movementType: text("movement_type").notNull(), // 'receipt' | 'adjustment' | 'count_variance'
  quantityDelta: integer("quantity_delta").notNull(),
  reason: text("reason"),
  actorStaffUserId: uuid("actor_staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  operationId: uuid("operation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Owner/manager-approved FX rates (ADR 0004) — reports and rate-derived
// prices read this, never "today's rate" implicitly.
export const exchangeRates = pgTable("exchange_rates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  baseCurrency: text("base_currency").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
  source: text("source").notNull(),
  approvedBy: uuid("approved_by")
    .notNull()
    .references(() => staffUsers.id),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
});

// Blind stock counts — the counting staff member never sees the expected
// quantity (enforced by stockflow_submit_stock_count never returning it
// to a non-owner/manager caller); a variance beyond zero always requires
// owner/manager approval before it becomes a stock_movements row.
export const stockCounts = pgTable("stock_counts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  status: text("status").notNull().default("open"), // 'open' | 'submitted' | 'approved'
  createdBy: uuid("created_by")
    .notNull()
    .references(() => staffUsers.id),
  approvedBy: uuid("approved_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

export const stockCountLines = pgTable("stock_count_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  stockCountId: uuid("stock_count_id")
    .notNull()
    .references(() => stockCounts.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  countedQuantity: integer("counted_quantity").notNull(),
  expectedQuantity: integer("expected_quantity"), // filled in at submit time, not before
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sprint 3 — Offline-Safe POS, Returns & Cash-up. All rows in this
// section are written exclusively through SECURITY DEFINER RPCs
// (lib/db/migrations/0007_sales_cashup_tables.sql and 0008_sales_cashup_rls_and_functions.sql) — never a direct
// insert policy — because sale/return/cash-up creation is atomic,
// multi-row and idempotency/rate-lookup logic that plain RLS can't
// express (same reasoning as the Sprint 2 blind-count RPCs). Money
// columns follow ADR 0004's snapshot model throughout.

export const cashSessions = pgTable("cash_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  openedBy: uuid("opened_by")
    .notNull()
    .references(() => staffUsers.id),
  openingFloatMinor: integer("opening_float_minor").notNull().default(0),
  openingCurrency: text("opening_currency").notNull(), // ZIG | USD | ZAR
  status: text("status").notNull().default("open"), // 'open' | 'closed'
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: uuid("closed_by").references(() => staffUsers.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

// Append-only. Sale currency/tender/rate snapshot per ADR 0004;
// reporting_amount_minor is the server-computed total in the tenant's
// reporting currency (never client-trusted — see migration comments).
export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  cashierStaffUserId: uuid("cashier_staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  operationId: uuid("operation_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  exchangeRateSnapshot: numeric("exchange_rate_snapshot", { precision: 18, scale: 8 }).notNull(),
  reportingCurrencyCode: text("reporting_currency_code").notNull(),
  reportingAmountMinor: integer("reporting_amount_minor").notNull(),
  rateSource: text("rate_source").notNull(),
  rateApprovedBy: uuid("rate_approved_by").references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saleItems = pgTable("sale_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  saleId: uuid("sale_id")
    .notNull()
    .references(() => sales.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
  unitCostPriceMinor: integer("unit_cost_price_minor").notNull(), // products.cost_price_minor snapshot at sale time, for Sprint 5 COGS
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. direction 'in' = money received by the business (sale
// tender, customer debt repayment); 'out' = money paid out (refund,
// supplier payment). Split tender means multiple 'in' rows per sale,
// potentially different tender_type/currency_code each. Exactly one of
// sale_id/customer_id/supplier_id is set — Sprint 4 (0010 migration)
// widened this table to also carry standalone customer-repayment and
// supplier-payment events so they still flow into cash-up reconciliation
// (lib/db/migrations/0010_customers_suppliers_credit.sql).
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  saleId: uuid("sale_id").references(() => sales.id),
  returnId: uuid("return_id"), // set only for direction='out' refund rows; references returns.id (added after returns table below)
  customerId: uuid("customer_id"), // set only for standalone customer debt repayments; references customers.id (added in Sprint 4)
  supplierId: uuid("supplier_id"), // set only for standalone supplier payments; references suppliers.id (added in Sprint 4)
  cashSessionId: uuid("cash_session_id").references(() => cashSessions.id),
  direction: text("direction").notNull(), // 'in' | 'out'
  tenderType: text("tender_type").notNull(), // 'cash' | 'mobile_money' | 'card' | 'bank_transfer'
  amountMinor: integer("amount_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  exchangeRateSnapshot: numeric("exchange_rate_snapshot", { precision: 18, scale: 8 }).notNull(),
  reportingCurrencyCode: text("reporting_currency_code").notNull(),
  reportingAmountMinor: integer("reporting_amount_minor").notNull(),
  rateSource: text("rate_source").notNull(),
  rateApprovedBy: uuid("rate_approved_by").references(() => staffUsers.id),
  // Null only for provider-reconciled payments (Sprint 4, Paynow) — a
  // customer paying via a payment link has no staff actor or registered
  // device; self-documenting via provider_payments.resulting_payment_id
  // pointing back at this row.
  actorStaffUserId: uuid("actor_staff_user_id").references(() => staffUsers.id),
  deviceId: uuid("device_id").references(() => devices.id),
  operationId: uuid("operation_id").notNull().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Reversal record — never mutates the original sale (CLAUDE.md rule 2).
// A void is just a return covering every line of a sale.
export const returns = pgTable("returns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  originalSaleId: uuid("original_sale_id")
    .notNull()
    .references(() => sales.id),
  actorStaffUserId: uuid("actor_staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  operationId: uuid("operation_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const returnItems = pgTable("return_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  returnId: uuid("return_id")
    .notNull()
    .references(() => returns.id),
  saleItemId: uuid("sale_item_id")
    .notNull()
    .references(() => saleItems.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Physical cash-up counts entered at session close, one row per
// tender_type/currency_code combination actually used during the session.
export const cashCounts = pgTable("cash_counts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  cashSessionId: uuid("cash_session_id")
    .notNull()
    .references(() => cashSessions.id),
  tenderType: text("tender_type").notNull(),
  currencyCode: text("currency_code").notNull(),
  countedAmountMinor: integer("counted_amount_minor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Computed at session close: expected (from payments) vs counted.
// requires_review is set when |variance| exceeds
// tenants.cash_variance_threshold_minor; a manager must then review
// before the variance is considered resolved (sprints.md Sprint 3
// acceptance criterion).
export const cashVariances = pgTable("cash_variances", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  cashSessionId: uuid("cash_session_id")
    .notNull()
    .references(() => cashSessions.id),
  tenderType: text("tender_type").notNull(),
  currencyCode: text("currency_code").notNull(),
  expectedAmountMinor: integer("expected_amount_minor").notNull(),
  countedAmountMinor: integer("counted_amount_minor").notNull(),
  varianceMinor: integer("variance_minor").notNull(),
  reason: text("reason"),
  requiresReview: boolean("requires_review").notNull().default(false),
  reviewedBy: uuid("reviewed_by").references(() => staffUsers.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sprint 4 — Customers, Suppliers, Credit & Mobile-Money Reconciliation.
// Balances are never a stored column — always
// sum(ledger.reporting_amount_minor) for a customer/supplier, so the
// balance is reconstructable from history by construction (sprints.md's
// acceptance criterion), matching the same append-only discipline as
// stock_movements/sales. Written exclusively through SECURITY DEFINER
// RPCs (lib/db/migrations/0010_customers_suppliers_credit.sql,
// 0011_purchase_orders.sql).

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. amount_minor is signed in the ledger's own currency_code:
// positive increases what the customer owes (a credit sale), negative
// decreases it (a repayment). Balance = sum(reporting_amount_minor).
export const customerLedger = pgTable("customer_ledger", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  entryType: text("entry_type").notNull(), // 'credit_sale' | 'payment' | 'adjustment'
  amountMinor: integer("amount_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  exchangeRateSnapshot: numeric("exchange_rate_snapshot", { precision: 18, scale: 8 }).notNull(),
  reportingCurrencyCode: text("reporting_currency_code").notNull(),
  reportingAmountMinor: integer("reporting_amount_minor").notNull(),
  rateSource: text("rate_source").notNull(),
  rateApprovedBy: uuid("rate_approved_by").references(() => staffUsers.id),
  referenceSaleId: uuid("reference_sale_id").references(() => sales.id),
  referencePaymentId: uuid("reference_payment_id").references(() => payments.id),
  actorStaffUserId: uuid("actor_staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  operationId: uuid("operation_id").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. amount_minor positive = we owe the supplier more
// (goods received on credit), negative = we paid them down.
export const supplierLedger = pgTable("supplier_ledger", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  entryType: text("entry_type").notNull(), // 'purchase' | 'payment' | 'adjustment'
  amountMinor: integer("amount_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  exchangeRateSnapshot: numeric("exchange_rate_snapshot", { precision: 18, scale: 8 }).notNull(),
  reportingCurrencyCode: text("reporting_currency_code").notNull(),
  reportingAmountMinor: integer("reporting_amount_minor").notNull(),
  rateSource: text("rate_source").notNull(),
  rateApprovedBy: uuid("rate_approved_by").references(() => staffUsers.id),
  referencePurchaseReceiptId: uuid("reference_purchase_receipt_id"), // references purchase_receipts.id (defined below)
  referencePaymentId: uuid("reference_payment_id").references(() => payments.id),
  actorStaffUserId: uuid("actor_staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  operationId: uuid("operation_id").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  status: text("status").notNull().default("submitted"), // 'submitted' | 'received'
  createdBy: uuid("created_by")
    .notNull()
    .references(() => staffUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => purchaseOrders.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  quantityOrdered: integer("quantity_ordered").notNull(),
  unitCostMinor: integer("unit_cost_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
});

// The actual receiving event — captures discrepancies (ordered vs
// received per line, on purchase_receipt_lines) and landed cost
// (freight/other costs allocated proportionally across received lines).
export const purchaseReceipts = pgTable("purchase_receipts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => purchaseOrders.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  freightCostMinor: integer("freight_cost_minor").notNull().default(0),
  otherCostMinor: integer("other_cost_minor").notNull().default(0),
  currencyCode: text("currency_code").notNull(),
  receivedBy: uuid("received_by")
    .notNull()
    .references(() => staffUsers.id),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  operationId: uuid("operation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseReceiptLines = pgTable("purchase_receipt_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  purchaseReceiptId: uuid("purchase_receipt_id")
    .notNull()
    .references(() => purchaseReceipts.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  quantityOrdered: integer("quantity_ordered").notNull(),
  quantityReceived: integer("quantity_received").notNull(),
  landedUnitCostMinor: integer("landed_unit_cost_minor").notNull(), // base unit cost + allocated share of freight/other
  currencyCode: text("currency_code").notNull(),
});

// Paynow (ADR-pending) request -> webhook/poll -> reconciled lifecycle.
// Never trust a webhook alone: status only reaches 'confirmed' after
// signature verification, and a poll-based reconciliation fallback can
// independently reach the same state (sprints.md Sprint 4 acceptance
// criteria). No real Paynow sandbox credentials were available this
// sprint (docs/handoffs/sprint-4.md) — this table and its state machine
// are built and unit-tested against synthetic signed payloads only.
export const providerPayments = pgTable("provider_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  saleId: uuid("sale_id").references(() => sales.id),
  customerId: uuid("customer_id").references(() => customers.id),
  provider: text("provider").notNull().default("paynow"),
  providerReference: text("provider_reference"), // Paynow's pollurl-derived reference, set once known
  status: text("status").notNull().default("initiated"), // 'initiated' | 'confirmed' | 'failed' | 'cancelled'
  amountMinor: integer("amount_minor").notNull(),
  currencyCode: text("currency_code").notNull(),
  resultingPaymentId: uuid("resulting_payment_id").references(() => payments.id), // set once reconciled into payments
  lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every inbound webhook attempt, valid or not — an invalid signature must
// be rejected AND audited (sprints.md Sprint 4 acceptance criterion), not
// just silently dropped.
export const providerWebhookLog = pgTable("provider_webhook_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  providerPaymentId: uuid("provider_payment_id").references(() => providerPayments.id),
  provider: text("provider").notNull().default("paynow"),
  signatureValid: boolean("signature_valid").notNull(),
  rawBody: text("raw_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sprint 6 — Multi-device Conflict, Recovery & Resilience. Two offline
// devices can each independently commit a sale against the same
// physical last unit of stock — by the time they both sync, the goods
// are already with two different customers in the real world, so the
// sale itself is never rejected retroactively (CLAUDE.md rule 2: a
// completed sale is reversed by a linked record, never edited/undone).
// What must never happen is *silent* negative stock — this table is
// what makes it visible instead, created automatically by
// stockflow_create_sale (migration 0016) whenever a sale's own stock
// movement leaves stock_levels below zero for that product/branch.
export const stockConflicts = pgTable("stock_conflicts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  stockMovementId: uuid("stock_movement_id")
    .notNull()
    .references(() => stockMovements.id),
  resultingQuantity: integer("resulting_quantity").notNull(), // the negative stock_levels value at detection time
  resolved: boolean("resolved").notNull().default(false),
  resolutionNote: text("resolution_note"),
  resolvedBy: uuid("resolved_by").references(() => staffUsers.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
