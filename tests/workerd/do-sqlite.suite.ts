// Portable conformance suite for the Durable Object SQLite adapter.
//
// The same cases run inside workerd (real `ctx.storage` of a SQLite-backed Durable
// Object, see `scripts/test-workerd.mjs`) and under Bun against an in-memory fake of the
// Durable Object storage API (`tests/cloudflare.do-sqlite.test.ts`).
import {
  ChimpbaseEngine,
  createChimpbaseRegistry,
  createDefaultChimpbasePlatformShim,
  type ChimpbaseEngineAdapter,
  type ChimpbaseRegistry,
} from "../../packages/core/index.ts";
import {
  createDurableObjectEngineAdapter,
  createDurableObjectSqliteDatabase,
  prepareDurableObjectSqlite,
  type DurableObjectSqliteDatabase,
  type DurableObjectSqliteStorageLike,
  type DurableObjectSqlValue,
} from "../../packages/cloudflare/src/index.ts";
import type { Generated } from "kysely";

import { action, type ChimpbaseContext } from "../../packages/runtime/index.ts";

export type DoSqliteCase = (storage: DurableObjectSqliteStorageLike) => Promise<void>;

interface TestHarness {
  adapter: ChimpbaseEngineAdapter;
  db: DurableObjectSqliteDatabase;
  engine: ChimpbaseEngine;
  registry: ChimpbaseRegistry;
  statements: string[];
}

const transactionControlPattern = /^\s*(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

function recordingStorage(storage: DurableObjectSqliteStorageLike, statements: string[]): DurableObjectSqliteStorageLike {
  return {
    sql: {
      exec(query: string, ...bindings: DurableObjectSqlValue[]) {
        statements.push(query);
        return storage.sql.exec(query, ...bindings);
      },
    },
    transactionSync: (callback) => storage.transactionSync(callback),
    transaction: async (callback) => await storage.transaction(callback),
  };
}

async function createHarness(
  storage: DurableObjectSqliteStorageLike,
  register: (registry: ChimpbaseRegistry) => void,
  options: { maxAttempts?: number; migrations?: { name: string; sql: string }[] } = {},
): Promise<TestHarness> {
  const statements: string[] = [];
  const db = createDurableObjectSqliteDatabase(recordingStorage(storage, statements));
  await prepareDurableObjectSqlite(db, { migrations: options.migrations ?? [] });
  const platform = createDefaultChimpbasePlatformShim();
  const adapter = createDurableObjectEngineAdapter(db, platform);
  const registry = createChimpbaseRegistry();
  register(registry);
  const engine = new ChimpbaseEngine({
    adapter,
    platform,
    registry,
    secrets: { get: () => null },
    subscriptions: { dispatch: "sync" },
    telemetry: { minLevel: "error", persist: { log: false, metric: false, trace: false } },
    worker: { leaseMs: 30_000, maxAttempts: options.maxAttempts ?? 3, retryDelayMs: 0 },
  });
  return { adapter, db, engine, registry, statements };
}

function registerAction(
  registry: ChimpbaseRegistry,
  name: string,
  handler: (ctx: ChimpbaseContext, ...args: unknown[]) => unknown,
): void {
  registry.actions.set(name, action(name, handler));
}

function registerWorker(
  registry: ChimpbaseRegistry,
  name: string,
  handler: (ctx: ChimpbaseContext, payload: unknown) => unknown,
): void {
  registry.workers.set(name, { definition: { dlq: `${name}.dlq` }, handler, module: null, name });
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

async function assertRejects(operation: () => Promise<unknown>, pattern: RegExp, label: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`${label}: unexpected error ${JSON.stringify(message)}`);
    return;
  }
  throw new Error(`${label}: expected a rejection`);
}

function assertThrows(operation: () => unknown, label: string): void {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`${label}: expected an exception`);
}

function count(db: DurableObjectSqliteDatabase, sql: string, ...params: unknown[]): number {
  const [row] = db.query(sql).all(...params);
  if (typeof row !== "object" || row === null || !("n" in row) || typeof row.n !== "number") {
    throw new Error(`count query returned ${JSON.stringify(row)}`);
  }
  return row.n;
}

function assertNoTransactionControl(statements: readonly string[], label: string): void {
  const offending = statements.filter((statement) => transactionControlPattern.test(statement));
  assertEqual(offending, [], `${label}: transaction control statements issued through sql.exec`);
}

export const doSqliteCases: Record<string, DoSqliteCase> = {
  async "storage rejects BEGIN/SAVEPOINT through sql.exec"(storage) {
    assertThrows(() => storage.sql.exec("BEGIN").toArray(), "BEGIN");
    assertThrows(() => storage.sql.exec("SAVEPOINT chimpbase_probe").toArray(), "SAVEPOINT");
  },

  async "kv set/get/list/delete across actions"(storage) {
    const { engine, statements } = await createHarness(storage, (registry) => {
      registerAction(registry, "put", async (ctx, key, value) => {
        await ctx.kv.set(String(key), value);
      });
      registerAction(registry, "get", async (ctx, key) => await ctx.kv.get(String(key)));
      registerAction(registry, "list", async (ctx) => await ctx.kv.list({ prefix: "user:" }));
      registerAction(registry, "del", async (ctx, key) => {
        await ctx.kv.delete(String(key));
      });
      registerAction(registry, "setIfAbsent", async (ctx, key, value) => await ctx.kv.setIfAbsent(String(key), value));
    });

    await engine.executeAction("put", ["user:1", { name: "Ada" }]);
    await engine.executeAction("put", ["user:2", { name: "Linus" }]);
    await engine.executeAction("put", ["other", 1]);
    assertEqual((await engine.executeAction("get", ["user:1"])).result, { name: "Ada" }, "get");
    assertEqual((await engine.executeAction("list")).result, ["user:1", "user:2"], "list");
    assertEqual((await engine.executeAction("setIfAbsent", ["user:1", 0])).result, false, "setIfAbsent existing");
    assertEqual((await engine.executeAction("setIfAbsent", ["user:3", 3])).result, true, "setIfAbsent new");
    await engine.executeAction("del", ["user:1"]);
    assertEqual((await engine.executeAction("get", ["user:1"])).result, null, "deleted");
    assertNoTransactionControl(statements, "kv");
  },

  async "failed action rolls back kv, collections, streams, and queue writes"(storage) {
    const { db, engine, statements } = await createHarness(storage, (registry) => {
      registerAction(registry, "writeThenFail", async (ctx) => {
        await ctx.kv.set("k", "v");
        await ctx.collection.insert("todos", { title: "a" });
        await ctx.stream.append("audit", "created", { id: 1 });
        await ctx.enqueue("emails", { to: "a@example.com" });
        ctx.pubsub.publish("todo.created", { id: 1 });
        throw new Error("boom");
      });
      registerWorker(registry, "emails", () => undefined);
    });

    await assertRejects(async () => await engine.executeAction("writeThenFail"), /boom/, "action");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_kv"), 0, "kv rows");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_collections"), 0, "collection rows");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_stream_events"), 0, "stream rows");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_queue_jobs"), 0, "queue rows");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_events"), 0, "event rows");
    assertNoTransactionControl(statements, "rollback");
  },

  async "nested action calls share the root transaction"(storage) {
    const { db, engine } = await createHarness(storage, (registry) => {
      registerAction(registry, "inner", async (ctx, key) => {
        await ctx.kv.set(String(key), true);
        return "inner-ok";
      });
      registerAction(registry, "outerOk", async (ctx) => {
        await ctx.kv.set("outer-ok", true);
        return await ctx.action("inner", "inner-ok");
      });
      registerAction(registry, "outerFail", async (ctx) => {
        await ctx.action("inner", "inner-fail");
        await ctx.kv.set("outer-fail", true);
        throw new Error("outer failed after inner committed its part");
      });
      registerAction(registry, "outerCatchesInner", async (ctx) => {
        await ctx.kv.set("outer-catch", true);
        try {
          await ctx.action("throwing");
        } catch {
          // The engine poisons the root transaction once a nested call fails.
        }
        return "unreachable";
      });
      registerAction(registry, "throwing", async (ctx) => {
        await ctx.kv.set("throwing", true);
        throw new Error("inner boom");
      });
    });

    assertEqual((await engine.executeAction("outerOk")).result, "inner-ok", "outerOk result");
    await assertRejects(async () => await engine.executeAction("outerFail"), /outer failed/, "outerFail");
    await assertRejects(async () => await engine.executeAction("outerCatchesInner"), /inner boom/, "outerCatchesInner");
    const keys = db.query("SELECT key FROM _chimpbase_kv ORDER BY key").all();
    assertEqual(keys, [{ key: "inner-ok" }, { key: "outer-ok" }], "committed keys");
  },

  async "queue enqueue, claim, and complete"(storage) {
    const processed: unknown[] = [];
    const { db, engine, statements } = await createHarness(storage, (registry) => {
      registerAction(registry, "enqueue", async (ctx, payload) => await ctx.enqueue("jobs", payload));
      registerWorker(registry, "jobs", async (ctx, payload) => {
        processed.push(payload);
        await ctx.kv.set(`done:${JSON.stringify(payload)}`, true);
      });
    });

    const first = (await engine.executeAction("enqueue", [{ n: 1 }])).result;
    const second = (await engine.executeAction("enqueue", [{ n: 2 }])).result;
    if (typeof first !== "number" || typeof second !== "number" || second <= first) {
      throw new Error(`enqueue returned ids ${String(first)}, ${String(second)}`);
    }
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_queue_jobs WHERE status = 'pending'"), 2, "pending");

    const one = await engine.processNextQueueJob();
    const two = await engine.processNextQueueJob();
    const none = await engine.processNextQueueJob();
    assertEqual([one?.jobId, two?.jobId, none], [first, second, null], "claimed jobs");
    assertEqual(processed, [{ n: 1 }, { n: 2 }], "processed payloads");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_queue_jobs WHERE status = 'completed'"), 2, "completed");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_kv WHERE key LIKE 'done:%'"), 2, "worker writes");
    assertNoTransactionControl(statements, "queue");
  },

  async "failing queue job rolls back its writes, retries, then dead-letters"(storage) {
    let attempts = 0;
    const { db, engine } = await createHarness(storage, (registry) => {
      registerAction(registry, "enqueue", async (ctx) => await ctx.enqueue("flaky", { id: 1 }));
      registerWorker(registry, "flaky", async (ctx) => {
        attempts += 1;
        await ctx.kv.set(`attempt:${attempts}`, true);
        throw new Error("worker failed");
      });
    }, { maxAttempts: 2 });

    await engine.executeAction("enqueue");
    await assertRejects(async () => await engine.processNextQueueJob(), /worker failed/, "first attempt");
    assertEqual(
      db.query("SELECT status, attempt_count FROM _chimpbase_queue_jobs WHERE queue_name = 'flaky'").all(),
      [{ status: "pending", attempt_count: 1 }],
      "after first failure",
    );
    await assertRejects(async () => await engine.processNextQueueJob(), /worker failed/, "second attempt");
    assertEqual(
      db.query("SELECT status, attempt_count FROM _chimpbase_queue_jobs WHERE queue_name = 'flaky'").all(),
      [{ status: "dlq", attempt_count: 2 }],
      "after second failure",
    );
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_queue_jobs WHERE queue_name = 'flaky.dlq'"), 1, "dlq envelope");
    assertEqual(attempts, 2, "attempts");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_kv"), 0, "worker writes rolled back");
  },

  async "sync subscriptions run inside the action transaction"(storage) {
    const { db, engine } = await createHarness(storage, (registry) => {
      registerAction(registry, "create", async (ctx, id) => {
        await ctx.collection.insert("orders", { orderId: id });
        ctx.pubsub.publish("order.created", { id });
      });
      registry.subscriptions.set("order.created", [{
        dispatch: "sync",
        handler: async (ctx: ChimpbaseContext, payload: unknown) => {
          if (typeof payload === "object" && payload !== null && "id" in payload && payload.id === "bad") {
            throw new Error("subscription rejected");
          }
          await ctx.kv.set(`seen:${JSON.stringify(payload)}`, true);
        },
        idempotent: false,
        module: null,
        name: "audit",
      }]);
    });

    const ok = await engine.executeAction("create", ["good"]);
    assertEqual(ok.emittedEvents.map((event) => event.name), ["order.created"], "emitted");
    await assertRejects(async () => await engine.executeAction("create", ["bad"]), /subscription rejected/, "bad");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_collections"), 1, "orders");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_events"), 1, "events");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_kv"), 1, "subscription writes");
  },

  async "collections and streams"(storage) {
    const { engine } = await createHarness(storage, (registry) => {
      registerAction(registry, "run", async (ctx) => {
        await ctx.collection.insert("todos", { title: "a", done: false });
        await ctx.collection.insert("todos", { title: "b", done: false });
        const updated = await ctx.collection.update("todos", { title: "a" }, { done: true });
        const done = await ctx.collection.find("todos", { done: true });
        const deleted = await ctx.collection.delete("todos", { title: "b" });
        await ctx.stream.append("audit", "one", { n: 1 });
        await ctx.stream.append("audit", "two", { n: 2 });
        const events = await ctx.stream.read("audit");
        return {
          deleted,
          doneTitles: done.map((doc) => doc.title),
          names: await ctx.collection.list(),
          streamEvents: events.map((event) => [event.event, event.payload]),
          updated,
        };
      });
    });

    assertEqual((await engine.executeAction("run")).result, {
      deleted: 1,
      doneTitles: ["a"],
      names: ["todos"],
      streamEvents: [["one", { n: 1 }], ["two", { n: 2 }]],
      updated: 1,
    }, "result");
  },

  async "raw SQL and Kysely against migrated tables"(storage) {
    const { engine } = await createHarness(storage, (registry) => {
      registerAction(registry, "run", async (ctx) => {
        await ctx.db.query("INSERT INTO notes (body, pinned) VALUES (?1, ?2)", ["first", true]);
        await ctx.db.query("INSERT INTO notes (body, pinned) VALUES (?1, ?2)", ["second", false]);
        const raw = await ctx.db.query("SELECT body, pinned FROM notes ORDER BY id");
        const db = ctx.db.kysely<{ notes: { id: Generated<number>; body: string; pinned: number } }>();
        const inserted = await db.insertInto("notes").values({ body: "third", pinned: 0 }).executeTakeFirst();
        const updated = await db.updateTable("notes").set({ pinned: 1 }).where("body", "=", "third").executeTakeFirst();
        const rows = await db.selectFrom("notes").select(["body"]).where("pinned", "=", 1).orderBy("id").execute();
        return {
          insertedId: Number(inserted.insertId),
          pinned: rows.map((row) => row.body),
          raw,
          updatedRows: Number(updated.numUpdatedRows),
        };
      });
    }, {
      migrations: [{
        name: "001_notes",
        sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0)",
      }],
    });

    assertEqual((await engine.executeAction("run")).result, {
      insertedId: 3,
      pinned: ["first", "third"],
      raw: [{ body: "first", pinned: 1 }, { body: "second", pinned: 0 }],
      updatedRows: 1,
    }, "result");
  },

  async "migrations apply once and a failing batch rolls back"(storage) {
    const statements: string[] = [];
    const db = createDurableObjectSqliteDatabase(recordingStorage(storage, statements));
    const migrations = [{ name: "001_a", sql: "CREATE TABLE a (id INTEGER PRIMARY KEY)" }];
    await prepareDurableObjectSqlite(db, { migrations });
    await prepareDurableObjectSqlite(db, { migrations });
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_migrations"), 1, "applied once");

    await assertRejects(async () => await prepareDurableObjectSqlite(db, {
      migrations: [
        ...migrations,
        { name: "002_b", sql: "CREATE TABLE b (id INTEGER PRIMARY KEY)" },
        { name: "003_broken", sql: "CREATE TABLE broken (" },
      ],
    }), /./, "broken migration");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM _chimpbase_migrations"), 1, "batch rolled back");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'b'"), 0, "table b rolled back");
    assertNoTransactionControl(statements, "migrations");
  },

  async "cron schedule claim uses transactionSync"(storage) {
    const { adapter, statements } = await createHarness(storage, () => {});
    await adapter.upsertCronSchedule("nightly", "0 0 * * *", 1);
    const claimed = await adapter.claimNextCronSchedule(60_000, ["nightly"]);
    assertEqual(claimed?.schedule_name, "nightly", "claimed");
    assertEqual(await adapter.claimNextCronSchedule(60_000, ["nightly"]), null, "lease held");
    if (claimed === null) throw new Error("unreachable");
    await adapter.advanceCronSchedule("nightly", 1, 2, claimed.lease_token);
    assertEqual((await adapter.listCronSchedules()).map((row) => row.next_fire_at_ms), [2], "advanced");
    assertNoTransactionControl(statements, "cron");
  },

  async "nested transactionSync inside transaction rolls back with the outer transaction"(storage) {
    const db = createDurableObjectSqliteDatabase(storage);
    db.exec("CREATE TABLE IF NOT EXISTS nested_probe (label TEXT NOT NULL)");

    await assertRejects(async () => await db.transaction(async () => {
      db.query("INSERT INTO nested_probe (label) VALUES (?1)").run("outer");
      db.transactionSync(() => db.query("INSERT INTO nested_probe (label) VALUES (?1)").run("inner"));
      throw new Error("outer rollback");
    }), /outer rollback/, "outer");
    assertEqual(count(db, "SELECT COUNT(*) AS n FROM nested_probe"), 0, "all rolled back");

    await db.transaction(async () => {
      db.query("INSERT INTO nested_probe (label) VALUES (?1)").run("outer");
      try {
        db.transactionSync(() => {
          db.query("INSERT INTO nested_probe (label) VALUES (?1)").run("inner");
          throw new Error("inner rollback");
        });
      } catch {
        // Only the nested section rolls back.
      }
    });
    assertEqual(db.query("SELECT label FROM nested_probe").all(), [{ label: "outer" }], "inner rolled back only");
  },

  async "engine rejects begin/commit when the database owns transactions"(storage) {
    const { adapter } = await createHarness(storage, () => {});
    if (adapter.runInTransaction === undefined) throw new Error("runInTransaction hook missing");
    await assertRejects(async () => await adapter.beginTransaction(), /runInTransaction/, "begin");
    await assertRejects(async () => await adapter.commitTransaction(), /runInTransaction/, "commit");
  },
};
