# Cloudflare Durable Object storage (preview)

`chimpbase/runtime/cloudflare` runs the Chimpbase engine on the SQLite storage of a
[SQLite-backed Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
(`ctx.storage.sql`). It is the storage layer of the Chimpbase Edge plan; it does not yet
provide a full host (HTTP serving, background scheduling, or blobs).

```ts
import { DurableObject } from "cloudflare:workers";
import { ChimpbaseEngine, createChimpbaseRegistry } from "chimpbase/core";
import {
  createDurableObjectEngineAdapter,
  createDurableObjectSqliteDatabase,
  prepareDurableObjectSqlite,
} from "chimpbase/runtime/cloudflare";

export class App extends DurableObject {
  private readonly engine: ChimpbaseEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = createDurableObjectSqliteDatabase(ctx.storage);
    ctx.blockConcurrencyWhile(async () => await prepareDurableObjectSqlite(db, { migrations: [] }));
    const registry = createChimpbaseRegistry();
    // register actions, workers and subscriptions on `registry` here
    this.engine = new ChimpbaseEngine({
      adapter: createDurableObjectEngineAdapter(db),
      registry,
      secrets: { get: () => null },
      subscriptions: { dispatch: "sync" },
      telemetry: { minLevel: "info", persist: { log: false, metric: false, trace: false } },
      worker: { leaseMs: 30_000, maxAttempts: 5, retryDelayMs: 1_000 },
    });
  }
}
```

The class must use the SQLite storage backend (`new_sqlite_classes` in the Wrangler
migration) and the Worker needs the `nodejs_compat` compatibility flag (the runtime uses
`AsyncLocalStorage`).

## Transactions

Durable Objects reject `BEGIN`, `COMMIT`, `ROLLBACK`, and `SAVEPOINT` statements sent
through `ctx.storage.sql.exec`. The adapter therefore never issues them:

- A root engine transaction (an action, route, worker job, sync subscription chain, ...)
  runs inside `ctx.storage.transaction(async () => ...)` through the engine's
  `runInTransaction` adapter hook. Engine callbacks are asynchronous, and
  `ctx.storage.transactionSync` only accepts synchronous callbacks. A rejected callback
  rolls back every write made through `ctx.storage.sql` during it.
- Short synchronous atomic sections (queue and cron claims, migrations) run inside
  `ctx.storage.transactionSync`.
- Nested engine transactions (an action calling another action) join the root
  transaction, exactly like on Bun and Node. A `transactionSync` section started inside
  `ctx.storage.transaction` nests and rolls back with it.

## Limits

- One engine per Durable Object, with serialized operations, as on the Bun and Node SQLite
  hosts. If an action awaits non-storage I/O (for example `fetch`), the Durable Object's
  input gate opens and other requests may run while its transaction is still open; do not
  run a second engine operation concurrently.
- `run()` reports `changes` and `lastInsertRowid` from SQLite's `changes()` and
  `last_insert_rowid()`. Because Durable Object SQL cannot prepare a statement without
  running it, statements are classified as row-returning by their leading keyword
  (`SELECT`, `WITH`, `VALUES`, `PRAGMA`, `EXPLAIN`) or a `RETURNING` clause.
- Bindings accept strings, numbers, booleans (stored as 0/1), `null`, safe-range `bigint`
  values, `ArrayBuffer`, and typed arrays. BLOB columns are returned as `Uint8Array`.
- Not implemented yet: the alarm-based scheduler for queue jobs, cron and workflow timers
  (T3; until then call `engine.processNextQueueJob()` / `engine.processNextCronSchedule()`
  yourself) and an R2 blob driver (T4; do not configure `blobs`).

## Tests

`bun run test:workerd` runs the adapter's conformance suite (`tests/workerd`) inside
workerd through a local Miniflare instance. No Cloudflare account or secrets are needed.
The same suite also runs under `bun test` against an in-memory fake of the storage API.

This directory is a private workspace implementation package. Published consumers receive
compiled JavaScript and TypeScript declarations through `chimpbase/runtime/cloudflare`.
