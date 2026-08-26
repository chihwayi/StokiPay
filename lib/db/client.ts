import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Connects to the self-hosted Postgres instance (self-hosted Supabase stack
// on Coolify — see docs/adr/0001-self-hosted-coolify-data-platform.md).
// Schema is added starting Sprint 1; this Sprint 0 file only proves the
// connection wiring and env var work end to end.
function createDbClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client);
}

export const db = createDbClient();
