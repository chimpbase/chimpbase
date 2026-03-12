# chimpbase

Build action-driven backends with a small runtime surface.

The posture is simple:

- write TypeScript
- pick a host package for Bun or Deno CLI/self-hosted
- use Postgres in production
- use SQLite or memory when local simplicity matters
- keep the primitives close to the problem
- avoid boilerplate and extra infrastructure too early

## Install

Host packages available today:

- `@chimpbase/bun` for Bun-first applications
- `@chimpbase/deno` for Deno CLI/self-hosted applications
- `@chimpbase/runtime` for explicit `chimpbase.app.ts`, `registrations`, and workflow definitions

For Bun:

```bash
bun add @chimpbase/bun
```

For Deno CLI/self-hosted:

```bash
deno add npm:@chimpbase/deno
```

Add `@chimpbase/runtime` when you want explicit app modules or workflow definitions.

The Deno host relies on Deno's npm and Node compatibility.

## Show me the code

Bun:

```ts
import { createChimpbase } from "@chimpbase/bun";

const chimpbase = await createChimpbase({
  telemetry: {
    minLevel: "info",
  },
  storage: { engine: "postgres", url: process.env.DATABASE_URL! },
});

chimpbase
  .action("createCustomer", async (ctx, input) => {
    const [customer] = await ctx.query<{ id: number }>(
      "insert into customers (email, name, plan) values (?1, ?2, ?3) returning id",
      [input.email, input.name, input.plan],
    );

    await ctx.kv.set(`customer:${customer.id}:status`, "new");

    await ctx.collection.insert("customer_profiles", {
      customerId: customer.id,
      plan: input.plan,
      source: "signup",
    });

    await ctx.stream.append("customers", "customer.created", {
      customerId: customer.id,
      email: input.email,
    });

    ctx.pubsub.publish("customer.created", {
      customerId: customer.id,
      email: input.email,
    });

    return customer;
  })
  .subscription("customer.created", async (ctx, event) => {
    await ctx.queue.enqueue("customer.sync", event);
  }, { idempotent: true, name: "enqueueCustomerSync" })
  .worker("customer.sync", async (ctx, event) => {
    const apiKey = ctx.secret("CRM_API_KEY");

    ctx.log.info("syncing customer", { customerId: event.customerId });
    ctx.metric("customer_sync_total", 1, { source: "crm" });

    await ctx.collection.update(
      "customer_profiles",
      { customerId: event.customerId },
      { syncedWithCrm: true },
    );

    return { apiKeyLoaded: Boolean(apiKey) };
  });

await chimpbase.start();
```

Deno CLI/self-hosted:

```ts
import { createChimpbaseDeno } from "npm:@chimpbase/deno";

const chimpbase = await createChimpbaseDeno({
  storage: { engine: "sqlite", path: "data/acme-deno.db" },
});

chimpbase.action("health", async () => ({ ok: true }));

await chimpbase.start();
```

For one-file apps, that is the smallest shape chimpbase is optimizing for:

- SQL when you want SQL
- one host instance with explicit registrations
- no extra app wrapper when you do not need one
- deploy/runtime wiring provided by the host package

For multi-module apps, keep `chimpbase.app.ts` explicit and export `registrations`.

That is still the canonical composition shape for larger projects:

- SQL when you want SQL
- one code-first app definition with `registrations`
- deploy/runtime wiring provided by the host package

`createChimpbase.from(import.meta.dir)` and `createChimpbaseDeno.from(Deno.cwd())` still exist as compatibility helpers. If `chimpbase.app.ts` is present, those loaders now prefer it over legacy project discovery.

## Why this feels simple

Most backend complexity is real complexity:

- state changes
- side effects
- retries
- delayed work
- long-running business logic

The mistake is usually adding too many concepts around that.

The shared runtime model stays tight:

- `action(...)` for business operations
- `subscription(...)` for ephemeral internal pub/sub
- `worker(...)` for background work
- `cron(...)` for recurring scheduled work
- `workflow(...)` when a process has to survive time

Everything runs on the same engine and can share the same storage story.

## Postgres first, SQLite when local

SQLite and memory are supported for local work and fast tests.

But the default recommendation is:

use Postgres.

That gives you a clean baseline:

- application data in Postgres
- queue state in Postgres
- durable workflow state in Postgres
- no broker required on day one
- no extra service just to coordinate background work

If `DATABASE_URL` is present, the Bun and Deno hosts both take the Postgres path automatically.

## The primitives

The value of this project is mostly in the primitives, not in hiding your backend behind a giant framework.

### `query`

Use raw SQL directly.

If your domain wants a table, join, transaction or `RETURNING`, just write it.

### `pubsub.publish` + `subscription`

Use ephemeral pub/sub for internal choreography without turning your codebase into a message-broker thesis.

Publish from an action, react in subscriptions, keep the flow explicit.

#### Idempotent subscriptions

Cross-process event delivery can cause duplicate dispatches (e.g., on container restart before the high-water mark advances). Mark a subscription as idempotent to skip events it has already processed:

```ts
subscription("order.created", handleOrderCreated, {
  idempotent: true,
  name: "handleOrderCreated",
});
```

When `idempotent: true`, the check and handler execution happen atomically inside the same DB transaction. A stable `name` is required so the deduplication marker is deterministic. Events without an `id` (local-only events) bypass the check automatically.

If you want those deduplication markers pruned automatically:

```ts
subscriptions: {
  idempotency: {
    retention: {
      enabled: true,
      maxAgeDays: 14,        // default: 30
      schedule: "15 2 * * *", // default: "0 2 * * *"
    },
  },
}
```

This registers an internal cron (`__chimpbase.subscription.idempotency.cleanup`) that scans `_chimpbase.sub.seen:*` keys and deletes markers older than `maxAgeDays`.

### `queue.enqueue` + `worker`

Use `queue.enqueue(...)` to dispatch durable jobs and `worker(...)` to process them.

This is the primitive for “do this later” or “do this out of band”.

### `cron`

Use `cron(...)` for durable recurring schedules such as rollups, reminders and operational snapshots.

Cron expressions use the standard 5-field shape in UTC and handlers run through the same worker path as queues.

### `kv`

Use `kv` for tiny pieces of operational state that do not deserve a full table yet.

### `collection`

Use `collection` when you want schemaless documents for side data, operational metadata or app-owned blobs.

### `stream.append` + `stream.read`

Use `stream` when you want append/read semantics for timelines, activity feeds or internal event history.

### `secret`

Use `secret(name)` for preloaded secrets.

The runtime can load them from mounted files, environment variables and `.env`, but that detail stays out of your app code.

### `log`, `metric`, `trace`

These primitives keep observability close to the code that matters, instead of forcing a separate abstraction layer for everything.

Telemetry can optionally be persisted into dedicated event streams for debugging and analytics. See the [Telemetry persistence](#telemetry-persistence) section below.

### `action`

You can call another action from inside the runtime when you want to reuse a business operation without opening another transport path.

## Quick start

From this repository:

```bash
bun install
bun test
```

Run the plain TypeScript example from the monorepo root:

```bash
cp examples/bun/todo-ts/.env.example examples/bun/todo-ts/.env
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/chimpbase
bun run dev:todo-ts
```

Run an action directly from the monorepo root:

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/chimpbase
bun run --filter @chimpbase/example-todo-ts action -- seedDemoWorkspace '[]'
```

If you want the intended experience, start with `examples/bun/todo-ts`, but install dependencies only once at the repository root.

## What this is good for

This repo is a strong fit when you want to build:

- internal systems
- operational tooling
- product backends
- evented business flows
- async-heavy applications without a huge platform footprint

It is especially useful when your instinct is:

“I want to solve the domain problem, not spend a week wiring glue.”

## Durable cron schedules

Use `cron(...)` when work should happen on a recurring schedule and you want that schedule to live in the same runtime and storage model as the rest of the app.

Simple example:

```ts
import {
  action,
  cron,
} from "@chimpbase/runtime";

const captureTodoBacklogSnapshot = async (ctx, invocation) => {
  const [summary] = await ctx.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM todo_items
  `);

  await ctx.collection.insert("todo_backlog_snapshots", {
    capturedAt: invocation.fireAt,
    schedule: invocation.name,
    summary,
  });
};

chimpbase.register(
  cron("todo.backlog.snapshot", "*/15 * * * *", captureTodoBacklogSnapshot),
  action("listTodoBacklogSnapshots", async (ctx) =>
    await ctx.collection.find("todo_backlog_snapshots", {}, { limit: 50 }),
  ),
);
```

The important bit is the execution model:

- the schedule is durable
- the next fire time is advanced before the handler runs
- the handler itself runs through the worker path, so retries and failure handling stay consistent

For a concrete example in this repo, see `examples/bun/todo-ts/src/modules/todos/todo.cron.ts`.

## Telemetry persistence

By default, `ctx.log`, `ctx.metric` and `ctx.trace` are collected in memory and available via `drainTelemetryRecords()`. You can also persist them into dedicated event streams backed by the same Postgres or SQLite storage.

### Enable globally

```ts
const chimpbase = await createChimpbase({
  telemetry: {
    persist: { log: true, metric: true, trace: true },
  },
  storage: { engine: "sqlite", path: "data/telemetry-app.db" },
});
```

When enabled, telemetry records are buffered during handler execution and batch-appended to their respective streams after the handler completes:

| Stream | Event names | Payload |
|---|---|---|
| `_chimpbase.logs` | `log.debug`, `log.info`, `log.warn`, `log.error` | `{ message, attributes, scope, timestamp }` |
| `_chimpbase.metrics` | `metric` | `{ name, value, labels, scope, timestamp }` |
| `_chimpbase.traces` | `trace.start`, `trace.end` | `{ name, phase, status?, attributes, scope, timestamp }` |

You can read them back with `ctx.stream.read("_chimpbase.logs")` like any other stream.

### Filter by log level

Only persist warnings and errors:

```ts
telemetry: {
  persist: { log: true },
  minLevel: "warn",
}
```

### Per-handler override

Override the global setting on individual actions, workers, subscriptions or crons:

```ts
// Opt a noisy action out of telemetry persistence
action("healthCheck", handler, { telemetry: false });

// Opt a specific action in when global is off
action("importantAction", handler, { telemetry: { log: true, metric: true } });

// Only disable trace persistence for one worker
worker("fastWorker", handler, undefined, { telemetry: { trace: false } });
```

### Automatic cleanup

Enable retention to automatically delete old telemetry stream events:

```ts
const chimpbase = await createChimpbase({
  telemetry: {
    persist: { log: true, metric: true, trace: true },
  },
  storage: { engine: "postgres", url: process.env.DATABASE_URL! },
  telemetryRetention: {
    enabled: true,
    maxAgeDays: 14,         // default: 30
    schedule: "0 3 * * *",  // default: "0 2 * * *" (daily at 2am UTC)
  },
});
```

This registers an internal cron (`__chimpbase.telemetry.cleanup`) that runs on the configured schedule and deletes telemetry stream events older than `maxAgeDays`.

## Durable workflows

Workflows exist here for the cases where actions, subscriptions and queues stop being enough by themselves.

Use them when a process needs to:

- survive restarts
- wait for time to pass
- wait for an external signal
- keep explicit state over days, weeks or months

Simple example:

```ts
import {
  action,
  workflow,
} from "@chimpbase/runtime";

const onboarding = workflow({
  name: "customer.onboarding",
  version: 1,
  initialState(input) {
    return {
      customerId: input.customerId,
      phase: "provision",
      kickoffCompletedAt: null,
      provisioned: false,
    };
  },
  async run(wf) {
    if (wf.state.phase === "provision") {
      await wf.action("provisionCustomer", wf.state.customerId);
      return wf.transition({
        ...wf.state,
        phase: "waiting_kickoff",
        provisioned: true,
      });
    }

    if (wf.state.phase === "waiting_kickoff") {
      return wf.waitForSignal("kickoff.completed", {
        stepId: "wait-kickoff",
        timeoutMs: 14 * 24 * 60 * 60 * 1000,
        onSignal: ({ payload, state }) => ({
          ...state,
          kickoffCompletedAt: payload.completedAt,
          phase: "done",
        }),
        onTimeout: "fail",
      });
    }

    if (wf.state.phase === "done") {
      return wf.complete(wf.state);
    }

    return wf.fail(`unknown phase: ${wf.state.phase}`);
  },
});

chimpbase.register(
  onboarding,
  action("provisionCustomer", async (_ctx, customerId) => {
    return { customerId, ok: true };
  }),
  action("startOnboarding", async (ctx, customerId) => {
    return await ctx.workflow.start("customer.onboarding", { customerId }, {
      workflowId: `workflow:${customerId}`,
    });
  }),
  action("completeKickoff", async (ctx, customerId, completedAt) => {
    await ctx.workflow.signal(`workflow:${customerId}`, "kickoff.completed", { completedAt });
    return { ok: true };
  }),
);
```

There is also workflow contract sync in the CLI:

```bash
bun packages/bun/src/cli.ts contracts --project-dir ./my-project
bun packages/bun/src/cli.ts contracts --project-dir ./my-project --check
deno run -A packages/deno/src/cli.ts contracts --project-dir ./my-project
deno run -A packages/deno/src/cli.ts contracts --project-dir ./my-project --check
```

That gives you versioned snapshots and compatibility checks without introducing another workflow platform.

## Examples

The repo currently ships with Bun examples:

- `examples/bun/todo-ts`
- `examples/bun/todo-ts` includes a cron example in `src/modules/todos/todo.cron.ts`
- `examples/bun/todo-ts-decorators`
- `examples/bun/todo-ts-nestjs`
- `examples/bun/todo-ts-nestjs-decorators`

The Deno host is available for CLI/self-hosted projects and uses the same runtime DSL, but the repository examples have not been duplicated under `examples/deno` yet.

## Release model

The published packages intentionally ship TypeScript source files instead of a prebuilt `dist/` directory.

That means:

- `@chimpbase/bun` is Bun-first
- `@chimpbase/deno` is Deno CLI/self-hosted
- `@chimpbase/runtime` and `@chimpbase/core` are distributed as source for TypeScript-aware consumers
- the monorepo release check is `bun run release:check`
- the publish flow is `bun run release:publish`

This keeps the alpha small and honest while the host surface grows incrementally.

## Status

The project already has:

- SQLite integration coverage
- Postgres integration coverage
- Deno CLI/self-hosted host support for Postgres, SQLite and memory
- durable workflow tests
- workflow contract sync tests
- end-to-end tests for the examples

The intended reading is straightforward:

this is a Postgres-first runtime with practical local-storage options for developers who want to build serious systems with less ceremony.
