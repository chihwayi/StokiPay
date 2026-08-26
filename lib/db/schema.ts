import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
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
