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
