import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./schema";
import { SupabaseConnector } from "./connector";

// Singleton local-first database (ADR 0002). Browser-only — Next.js
// renders this module server-side too, so every export here is guarded
// or lazily constructed to avoid touching IndexedDB/WASM during SSR.
let instance: PowerSyncDatabase | null = null;
let connected = false;

export function getPowerSyncDb(): PowerSyncDatabase {
  if (typeof window === "undefined") {
    throw new Error("PowerSync is browser-only");
  }
  if (!instance) {
    instance = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: "stockflow.db" },
    });
  }
  return instance;
}

export async function connectPowerSync(): Promise<PowerSyncDatabase> {
  const db = getPowerSyncDb();
  if (!connected) {
    connected = true;
    await db.connect(new SupabaseConnector());
  }
  return db;
}
