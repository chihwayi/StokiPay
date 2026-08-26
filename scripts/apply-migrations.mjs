import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// Applies lib/db/migrations/*.sql in filename order, tracking what's
// already run in a _migrations table so repeat invocations (CI on every
// push, re-running locally against staging) are safe. Used locally
// (against the self-hosted staging Postgres, over the SSH tunnel
// documented in docs/handoffs/sprint-1.md) and in CI (against the
// ephemeral Postgres service container in .github/workflows/ci.yml). Not
// a drizzle-kit `migrate()` run because several migrations are
// hand-written RLS/function SQL, not schema-diff-generated.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const dir = join(import.meta.dirname, "..", "lib", "db", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres(connectionString, { ssl: false });

await sql`create table if not exists _migrations (filename text primary key, applied_at timestamptz not null default now())`;
const applied = new Set((await sql`select filename from _migrations`).map((r) => r.filename));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip ${file} (already applied)`);
    continue;
  }
  const contents = readFileSync(join(dir, file), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(contents);
    await tx`insert into _migrations (filename) values (${file})`;
  });
  console.log(`applied ${file}`);
}

await sql.end();
