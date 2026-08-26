import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// Applies lib/db/migrations/*.sql in filename order. Used locally (against
// the self-hosted staging Postgres, over the SSH tunnel documented in
// docs/handoffs/sprint-1.md) and in CI (against the ephemeral Postgres
// service container in .github/workflows/ci.yml). Not a drizzle-kit
// `migrate()` run because migration 0001 is hand-written RLS SQL, not
// schema-diff-generated.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const dir = join(import.meta.dirname, "..", "lib", "db", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres(connectionString, { ssl: false });

for (const file of files) {
  const contents = readFileSync(join(dir, file), "utf8");
  await sql.unsafe(contents);
  console.log(`applied ${file}`);
}

await sql.end();
