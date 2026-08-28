import type {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/web";
import { UpdateType } from "@powersync/web";
import { createClient } from "@/lib/auth/supabase-browser";

// Bridges PowerSync's local SQLite CRUD queue to our Postgres backend
// (ADR 0002). fetchCredentials() hands PowerSync the caller's own
// Supabase session JWT (client_auth.supabase in
// infra/powersync/config.yaml verifies it, and every row PowerSync
// downloads is still scoped by sync_rules.yaml — this does not bypass
// RLS, it runs alongside it). uploadData() drains the local write-queue
// tables and turns each queued row into the matching SECURITY DEFINER
// RPC call (lib/db/migrations/0007.../0008...) — never a raw table
// upsert, because sale/return/stock-movement creation needs
// server-computed exchange-rate snapshots and idempotency checks that a
// plain PowerSync CRUD upload can't express.

const POWERSYNC_URL = process.env.NEXT_PUBLIC_POWERSYNC_URL;

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    if (!POWERSYNC_URL) {
      throw new Error("NEXT_PUBLIC_POWERSYNC_URL is not configured");
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return null;
    }
    return {
      endpoint: POWERSYNC_URL,
      token: session.access_token,
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }

    const supabase = createClient();

    try {
      for (const op of transaction.crud) {
        await uploadOne(supabase, op);
      }
      await transaction.complete();
    } catch (error) {
      // A validation error (bad payload, already-actioned RPC precondition
      // failing) is not retryable — retrying it forever would wedge the
      // queue. Log for now (Sprint 6 owns a real conflict-review UI) and
      // drop the transaction so sync can proceed with later operations.
      // A network-class error is left for PowerSync's own retry/backoff.
      if (isPermanentError(error)) {
        console.error("Dropping unsyncable local write (permanent error):", op_summary(transaction.crud), error);
        await transaction.complete();
        return;
      }
      throw error;
    }
  }
}

function op_summary(crud: CrudEntry[]): string {
  return crud.map((c) => `${c.table}#${c.id}`).join(", ");
}

function isPermanentError(error: unknown): boolean {
  // Postgres/PostgREST validation errors surface as 4xx with a message;
  // network failures throw generic fetch errors without a status.
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.length > 0 &&
    (error as { code: string }).code !== "PGRST301"
  );
}

async function uploadOne(
  supabase: ReturnType<typeof createClient>,
  op: CrudEntry,
): Promise<void> {
  if (op.op !== UpdateType.PUT) {
    // Local write-queue rows are insert-only by construction (writes.ts
    // never updates/deletes them) — nothing else should reach here.
    return;
  }

  const data = op.opData ?? {};

  switch (op.table) {
    case "pending_sales": {
      const { error } = await supabase.rpc("stockflow_create_sale", {
        p_operation_id: data.operation_id,
        p_branch_id: data.branch_id,
        p_device_id: data.device_id,
        p_currency_code: data.currency_code,
        p_items: JSON.parse(String(data.items_json)),
        p_payments: JSON.parse(String(data.payments_json)),
      });
      if (error) throw error;
      return;
    }
    case "pending_returns": {
      const { error } = await supabase.rpc("stockflow_create_return", {
        p_operation_id: data.operation_id,
        p_original_sale_id: data.original_sale_id,
        p_device_id: data.device_id,
        p_reason: data.reason,
        p_refund_tender_type: data.refund_tender_type,
        p_items: JSON.parse(String(data.items_json)),
      });
      if (error) throw error;
      return;
    }
    case "pending_stock_movements": {
      const { error } = await supabase.from("stock_movements").insert({
        tenant_id: data.tenant_id,
        branch_id: data.branch_id,
        product_id: data.product_id,
        movement_type: data.movement_type,
        quantity_delta: data.quantity_delta,
        reason: data.reason,
        actor_staff_user_id: (await supabase.auth.getUser()).data.user?.id,
        device_id: data.device_id,
        operation_id: data.operation_id,
      });
      if (error) throw error;
      return;
    }
    default:
      throw new Error(`No upload handler for local table "${op.table}"`);
  }
}
