# @chimpbase/bun

Build complex backends with a small runtime surface.

The posture is simple:

- write TypeScript
- use Postgres
- keep the primitives close to the problem
- avoid boilerplate and extra infrastructure too early

## Install

```bash
bun add @chimpbase/bun @chimpbase/runtime
```

## Show me the code

```ts
import {
  action,
  queue,
  subscription,
} from "@chimpbase/runtime";
import { createChimpbase } from "@chimpbase/bun";

const chimpbase = await createChimpbase.from(import.meta.dir);

chimpbase.register(
  action("createCustomer", async (ctx, input) => {
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

    await ctx.stream.publish("customers", "customer.created", {
      customerId: customer.id,
      email: input.email,
    });

    ctx.pubsub.publish("customer.created", {
      customerId: customer.id,
      email: input.email,
    });

    return customer;
  }),

  subscription("customer.created", async (ctx, event) => {
    await ctx.queue.send("customer.sync", event);
  }),

  queue("customer.sync", async (ctx, event) => {
    const apiKey = ctx.secret("CRM_API_KEY");

    ctx.log.info("syncing customer", { customerId: event.customerId });
    ctx.metric("customer_sync_total", 1, { source: "crm" });

    await ctx.collection.update(
      "customer_profiles",
      { customerId: event.customerId },
      { syncedWithCrm: true },
    );

    return { apiKeyLoaded: Boolean(apiKey) };
  }),
);

await chimpbase.start();
```

That is the shape this project is optimizing for:

- SQL when you want SQL
- small runtime primitives for the glue around it
- one place to define actions, reactions and async work

## Why this feels simple

Most backend complexity is real complexity:

- state changes
- side effects
- retries
- delayed work
- long-running business logic

The mistake is usually adding too many concepts around that.

`@chimpbase/bun` keeps the model tighter:

- `action(...)` for business operations
- `subscription(...)` for ephemeral internal pub/sub
- `queue(...)` for background work
- `workflow(...)` when a process has to survive time

Everything runs on the same engine and can share the same storage story.

## Just use Postgres

SQLite is supported and tested. It is useful for local work and fast tests.

But the default recommendation is:

use Postgres.

That gives you a clean baseline:

- application data in Postgres
- queue state in Postgres
- durable workflow state in Postgres
- no broker required on day one
- no extra service just to coordinate background work

If `DATABASE_URL` is present, the runtime already takes the Postgres path automatically.

## The primitives

The value of this project is mostly in the primitives, not in hiding your backend behind a giant framework.

### `query`

Use raw SQL directly.

If your domain wants a table, join, transaction or `RETURNING`, just write it.

### `pubsub.publish` + `subscription`

Use ephemeral pub/sub for internal choreography without turning your codebase into a message-broker thesis.

Publish from an action, react in subscriptions, keep the flow explicit.

### `queue`

Use queues for background work, retries and delayed execution.

This is the primitive for “do this later” or “do this out of band”.

### `kv`

Use `kv` for tiny pieces of operational state that do not deserve a full table yet.

### `collection`

Use `collection` when you want schemaless documents for side data, operational metadata or app-owned blobs.

### `stream`

Use `stream` when you want append/read semantics for timelines, activity feeds or internal event history.

### `secret`

Use `secret(name)` for preloaded secrets.

The runtime can load them from mounted files, environment variables and `.env`, but that detail stays out of your app code.

### `log`, `metric`, `trace`

These primitives keep observability close to the code that matters, instead of forcing a separate abstraction layer for everything.

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
```

That gives you versioned snapshots and compatibility checks without introducing another workflow platform.

## Examples

The repo currently ships with:

- `examples/bun/todo-ts`
- `examples/bun/todo-ts-decorators`
- `examples/bun/todo-ts-nestjs`
- `examples/bun/todo-ts-nestjs-decorators`

## Distribution

For `0.1.1`, `@chimpbase/bun` is published as TypeScript source instead of a prebuilt `dist/` folder.

That is intentional:

- Bun executes the package directly
- the release surface stays small during alpha
- build artifacts are deferred until the multi-host story is in place

## Status

The project already has:

- SQLite integration coverage
- Postgres integration coverage
- durable workflow tests
- workflow contract sync tests
- end-to-end tests for the examples

The intended reading is straightforward:

this is a Postgres-first runtime for developers who want to build serious systems with less ceremony.
