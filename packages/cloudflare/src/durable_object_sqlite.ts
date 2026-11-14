import {
  applySqliteMigrations,
  createDefaultChimpbasePlatformShim,
  createSqliteEngineAdapter,
  ensureSqliteInternalTables,
  type ChimpbaseEngineAdapter,
  type ChimpbaseMigration,
  type ChimpbasePlatformShim,
  type ChimpbaseSqliteDatabase,
  type ChimpbaseSqliteStatement,
} from "@chimpbase/core";

/** Values accepted and returned by `ctx.storage.sql.exec` in a SQLite-backed Durable Object. */
export type DurableObjectSqlValue = ArrayBuffer | string | number | null;

/**
 * Structural subset of Cloudflare's `SqlStorageCursor`. Declared locally so this package
 * does not depend on `@cloudflare/workers-types`.
 */
export interface DurableObjectSqlCursorLike {
  readonly columnNames: string[];
  next(): { done?: false; value: Record<string, DurableObjectSqlValue> } | { done: true; value?: never };
  toArray(): Record<string, DurableObjectSqlValue>[];
}

/** Structural subset of Cloudflare's `SqlStorage` (`ctx.storage.sql`). */
export interface DurableObjectSqlStorageLike {
  exec(query: string, ...bindings: DurableObjectSqlValue[]): DurableObjectSqlCursorLike;
}

/**
 * Structural subset of Cloudflare's `DurableObjectStorage` (`ctx.storage`) for a
 * SQLite-backed Durable Object class.
 */
export interface DurableObjectSqliteStorageLike {
  readonly sql: DurableObjectSqlStorageLike;
  transactionSync<T>(callback: () => T): T;
  transaction<T>(callback: (txn: unknown) => Promise<T>): Promise<T>;
}

export interface DurableObjectSqliteDatabase extends ChimpbaseSqliteDatabase {
  transactionSync<T>(callback: () => T): T;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
}

export interface PrepareDurableObjectSqliteOptions {
  /** Ordered SQLite migrations, applied atomically and recorded in `_chimpbase_migrations`. */
  migrations?: readonly ChimpbaseMigration[];
}

/**
 * Wraps `ctx.storage` of a SQLite-backed Durable Object as a Chimpbase SQLite database.
 *
 * Durable Objects reject `BEGIN`, `COMMIT`, `ROLLBACK`, and `SAVEPOINT` statements, so this
 * database exposes the storage transaction APIs instead:
 * - `transactionSync` maps to `ctx.storage.transactionSync` and is used for short
 *   synchronous atomic sections (queue/cron claims, migrations).
 * - `transaction` maps to `ctx.storage.transaction` and is used by the engine for a whole
 *   root transaction (action, route, worker job, ...). The engine's callbacks are
 *   asynchronous, and `transactionSync` rejects callbacks that return a promise.
 */
export function createDurableObjectSqliteDatabase(storage: DurableObjectSqliteStorageLike): DurableObjectSqliteDatabase {
  const sql = storage.sql;
  return {
    exec(statement: string) {
      return sql.exec(statement).toArray();
    },
    query(statement: string): ChimpbaseSqliteStatement {
      return {
        reader: isReaderStatement(statement),
        all(...params: unknown[]) {
          return sql.exec(statement, ...toDurableObjectBindings(params)).toArray().map(fromDurableObjectRow);
        },
        iterate(...params: unknown[]) {
          return iterateCursor(sql.exec(statement, ...toDurableObjectBindings(params)));
        },
        run(...params: unknown[]) {
          sql.exec(statement, ...toDurableObjectBindings(params)).toArray();
          const [row] = sql.exec("SELECT changes() AS changes, last_insert_rowid() AS last_insert_rowid").toArray();
          return {
            changes: typeof row?.changes === "number" ? row.changes : 0,
            lastInsertRowid: typeof row?.last_insert_rowid === "number" ? row.last_insert_rowid : undefined,
          };
        },
      };
    },
    transactionSync<T>(callback: () => T): T {
      return storage.transactionSync(callback);
    },
    async transaction<T>(callback: () => Promise<T>): Promise<T> {
      return await storage.transaction(async () => await callback());
    },
  };
}

/**
 * Applies Chimpbase migrations and creates the internal `_chimpbase_*` tables. Call it
 * once per Durable Object instance, e.g. inside `ctx.blockConcurrencyWhile` in the
 * constructor.
 */
export async function prepareDurableObjectSqlite(
  db: DurableObjectSqliteDatabase,
  options: PrepareDurableObjectSqliteOptions = {},
): Promise<void> {
  applySqliteMigrations(db, options.migrations ?? []);
  await ensureSqliteInternalTables(db);
}

/**
 * Creates a Chimpbase engine adapter backed by Durable Object SQLite storage. Root engine
 * transactions run through `ctx.storage.transaction`; the adapter never issues
 * `BEGIN`/`COMMIT`/`ROLLBACK` statements.
 *
 * Like the Bun and Node SQLite hosts, one engine must not run overlapping operations:
 * serialize calls into the engine (one Durable Object instance = one serialized engine).
 */
export function createDurableObjectEngineAdapter(
  storageOrDatabase: DurableObjectSqliteStorageLike | DurableObjectSqliteDatabase,
  platform: ChimpbasePlatformShim = createDefaultChimpbasePlatformShim(),
): ChimpbaseEngineAdapter {
  const db = "sql" in storageOrDatabase ? createDurableObjectSqliteDatabase(storageOrDatabase) : storageOrDatabase;
  return createSqliteEngineAdapter(db, platform);
}

// Statements that return rows. Durable Object SQL has no prepare-without-execute API, so
// the reader flag is derived from the statement text instead of column metadata.
const readerStatementPattern = /^(?:SELECT|WITH|VALUES|PRAGMA|EXPLAIN)\b/i;
const returningPattern = /\bRETURNING\b/i;

function isReaderStatement(statement: string): boolean {
  const normalized = stripLeadingSqlComments(statement);
  return readerStatementPattern.test(normalized) || returningPattern.test(normalized);
}

function stripLeadingSqlComments(statement: string): string {
  let rest = statement.trimStart();
  for (;;) {
    if (rest.startsWith("--")) {
      const end = rest.indexOf("\n");
      rest = end === -1 ? "" : rest.slice(end + 1).trimStart();
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      rest = end === -1 ? "" : rest.slice(end + 2).trimStart();
    } else {
      return rest;
    }
  }
}

function* iterateCursor(cursor: DurableObjectSqlCursorLike): IterableIterator<unknown> {
  for (;;) {
    const next = cursor.next();
    if (next.done === true) return;
    yield fromDurableObjectRow(next.value);
  }
}

function fromDurableObjectRow(row: Record<string, DurableObjectSqlValue>): Record<string, unknown> {
  let converted: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof ArrayBuffer) {
      converted ??= { ...row };
      converted[key] = new Uint8Array(value);
    }
  }
  return converted ?? row;
}

function toDurableObjectBindings(params: readonly unknown[]): DurableObjectSqlValue[] {
  const bindings: DurableObjectSqlValue[] = [];
  for (const param of params) {
    if (param === null || typeof param === "string" || typeof param === "number") {
      bindings.push(param);
    } else if (typeof param === "boolean") {
      bindings.push(param ? 1 : 0);
    } else if (typeof param === "bigint") {
      if (param > BigInt(Number.MAX_SAFE_INTEGER) || param < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError("Durable Object SQLite bindings cannot represent bigint values outside the safe integer range");
      }
      bindings.push(Number(param));
    } else if (param instanceof ArrayBuffer) {
      bindings.push(param);
    } else if (ArrayBuffer.isView(param)) {
      bindings.push(new Uint8Array(param.buffer, param.byteOffset, param.byteLength).slice().buffer);
    } else {
      throw new TypeError("SQLite query parameters must be supported binding values");
    }
  }
  return bindings;
}
