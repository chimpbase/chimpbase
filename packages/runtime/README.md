# @chimpbase/runtime

Public runtime DSL for Chimpbase applications.

This is the package application code uses to declare:

- `action(...)`
- `listener(...)`
- `queue(...)`
- `workflow(...)`

It also exports the public context and durable workflow contracts that hosts consume.

## Typical usage

```ts
import { action, queue, register } from "@chimpbase/runtime";

chimpbase.register(
  action("createCustomer", async (ctx, input) => {
    await ctx.queue.send("customer.sync", input);
    return { ok: true };
  }),
  queue("customer.sync", async (ctx, payload) => {
    ctx.log.info("syncing customer", payload);
  }),
);
```

## 0.1.0 distribution model

`@chimpbase/runtime` is published as TypeScript source for the alpha release.

That keeps the public DSL close to the implementation and avoids introducing a build pipeline before the package surface settles.
