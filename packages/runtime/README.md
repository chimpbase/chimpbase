# @chimpbase/runtime

Public runtime DSL for Chimpbase applications.

This is the package application code uses to declare:

- `action(...)`
- `cron(...)`
- `subscription(...)`
- `worker(...)`
- `workflow(...)`

It also exports the public context and durable workflow contracts that hosts consume.

## Typical usage

```ts
import { action, cron, worker, register } from "@chimpbase/runtime";

chimpbase.register(
  action("createCustomer", async (ctx, input) => {
    await ctx.queue.enqueue("customer.sync", input);
    return { ok: true };
  }),
  cron("customer.rollup", "0 * * * *", async (ctx, invocation) => {
    await ctx.collection.insert("customer_rollups", {
      capturedAt: invocation.fireAt,
      schedule: invocation.name,
    });
  }),
  worker("customer.sync", async (ctx, payload) => {
    ctx.log.info("syncing customer", payload);
  }),
);
```

## Per-handler telemetry persistence

Starting in `0.1.4`, the `action()`, `worker()`, `subscription()` and `cron()` factories accept an optional `telemetry` override:

```ts
action("createCustomer", handler, { telemetry: { log: true, metric: true } });
worker("sync", handler, undefined, { telemetry: false });
```

This overrides the global `telemetry.persist` setting from `createChimpbase`. See `@chimpbase/bun` docs for the full configuration shape.

## 0.1.4 distribution model

`@chimpbase/runtime` is published as TypeScript source for the alpha release.

That keeps the public DSL close to the implementation and avoids introducing a build pipeline before the package surface settles.
