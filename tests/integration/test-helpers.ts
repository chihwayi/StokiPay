import postgres from "postgres";

class RollbackForCleanup extends Error {}

// Runs a query as a specific simulated authenticated user, mirroring what
// PostgREST does per-request (SET LOCAL role + request.jwt.claims), inside
// a transaction that's always rolled back so tests never mutate real data
// on shared instances (staging or CI's ephemeral Postgres).
export async function asUser<T>(
  sql: postgres.Sql,
  userId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let result!: T;
  await sql
    .begin(async (tx) => {
      if (userId) {
        await tx.unsafe(
          `set local role authenticated; set local request.jwt.claims = '${JSON.stringify({ sub: userId })}';`,
        );
      } else {
        await tx.unsafe(`set local role anon;`);
      }
      result = await fn(tx);
      throw new RollbackForCleanup();
    })
    .catch((e) => {
      if (!(e instanceof RollbackForCleanup)) throw e;
    });
  return result;
}
