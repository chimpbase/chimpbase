/**
 * Minimal surface needed to run a synchronous, atomic SQLite section.
 *
 * Hosts that forbid `BEGIN`/`COMMIT`/`SAVEPOINT` statements (for example Cloudflare
 * Durable Objects, where transactions must go through `ctx.storage.transactionSync`)
 * provide `transactionSync`; every other host falls back to `BEGIN IMMEDIATE`.
 */
export interface ChimpbaseSqliteSyncTransactionHost {
  exec(sql: string): unknown;
  transactionSync?<T>(callback: () => T): T;
}

export function runSqliteImmediateTransaction<T>(
  db: ChimpbaseSqliteSyncTransactionHost,
  callback: () => T,
): T {
  if (db.transactionSync !== undefined) {
    return db.transactionSync(callback);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite may already have rolled back the transaction.
    }
    throw error;
  }
}
