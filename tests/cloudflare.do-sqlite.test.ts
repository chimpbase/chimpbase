import { Database, type SQLQueryBindings } from "bun:sqlite";
import { describe, test } from "bun:test";

import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqliteStorageLike,
  DurableObjectSqlValue,
} from "../packages/cloudflare/src/index.ts";
import { doSqliteCases } from "./workerd/do-sqlite.suite.ts";

// The real Durable Object runs these cases in workerd (`bun run test:workerd`). This fake
// mirrors the parts of the storage API the adapter relies on, so the suite also runs in
// the regular Bun test job: `sql.exec` rejects transaction control statements, and
// `transactionSync`/`transaction` nest through savepoints like workerd does.
const transactionControlPattern = /^\s*(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

function createFakeDurableObjectStorage(): DurableObjectSqliteStorageLike {
  const db = new Database(":memory:");
  let depth = 0;

  const runInSavepoint = <T>(callback: () => T, finish: (result: T) => T): T => {
    const name = `fake_do_txn_${depth}`;
    db.run(`SAVEPOINT ${name}`);
    depth += 1;
    try {
      const result = finish(callback());
      depth -= 1;
      db.run(`RELEASE ${name}`);
      return result;
    } catch (error) {
      depth -= 1;
      db.run(`ROLLBACK TO ${name}`);
      db.run(`RELEASE ${name}`);
      throw error;
    }
  };

  return {
    sql: {
      exec(query: string, ...bindings: DurableObjectSqlValue[]): DurableObjectSqlCursorLike {
        if (transactionControlPattern.test(query)) {
          throw new Error("Durable Objects reject transaction control statements; use ctx.storage.transactionSync()");
        }
        let rows: Record<string, DurableObjectSqlValue>[];
        if (bindings.length === 0 && /;\s*\S/.test(query.trim().replace(/;\s*$/, ""))) {
          db.run(query);
          rows = [];
        } else {
          const statement = db.prepare(query);
          const values: SQLQueryBindings[] = bindings.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
          rows = statement.all(...values) as Record<string, DurableObjectSqlValue>[];
        }
        let index = 0;
        return {
          columnNames: rows[0] === undefined ? [] : Object.keys(rows[0]),
          next() {
            const value = rows[index];
            index += 1;
            return value === undefined ? { done: true } : { done: false, value };
          },
          toArray() {
            const rest = rows.slice(index);
            index = rows.length;
            return rest;
          },
        };
      },
    },
    transactionSync<T>(callback: () => T): T {
      return runInSavepoint(callback, (result) => {
        if (result instanceof Promise) throw new Error("transactionSync callback must not return a promise");
        return result;
      });
    },
    async transaction<T>(callback: (txn: unknown) => Promise<T>): Promise<T> {
      const name = `fake_do_txn_${depth}`;
      db.run(`SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = await callback({});
        depth -= 1;
        db.run(`RELEASE ${name}`);
        return result;
      } catch (error) {
        depth -= 1;
        db.run(`ROLLBACK TO ${name}`);
        db.run(`RELEASE ${name}`);
        throw error;
      }
    },
  };
}

describe("Durable Object SQLite adapter (Bun fake storage)", () => {
  for (const [name, run] of Object.entries(doSqliteCases)) {
    test(name, async () => {
      await run(createFakeDurableObjectStorage());
    });
  }
});
