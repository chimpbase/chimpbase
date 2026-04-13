# App Composition

For larger projects, compose your app in a `chimpbase.app.ts` file using `ChimpbaseAppDefinitionInput`:

```ts
import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { subscription, worker, cron } from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
import { createCustomer, listCustomers } from "./src/modules/customers.ts";
import { syncCustomer } from "./src/modules/sync.ts";

export default {
  project: { name: "my-app" },
  migrations,
  registrations: [
    createCustomer,
    listCustomers,
    subscription("customer.created", syncHandler, {
      idempotent: true,
      name: "enqueueSync",
    }),
    worker("customer.sync", syncCustomer),
    cron("reports.daily", "0 9 * * *", generateDailyReport),
  ],
} satisfies ChimpbaseAppDefinitionInput;
```

Run with:

```bash
bun run chimpbase.app.ts
```

## What goes in `ChimpbaseAppDefinitionInput`

| Option | Purpose |
|--------|---------|
| `project.name` | Project identifier used for internal table namespacing |
| `migrations` | Database migration definitions for your application tables |
| `registrations` | Array of actions, subscriptions, workers, cron jobs, and workflows |
| `httpHandler` | Optional HTTP handler (e.g. a Hono app) for REST endpoints |

## Registrations

All primitives go in a single `registrations` array. Actions are registered by their export name; subscriptions, workers, and cron jobs are created inline:

```ts
const registrations = [
  // Actions (name inferred from export)
  createProject,
  listProjects,
  createTodo,

  // Subscriptions
  subscription("todo.created", auditTodoCreated, {
    idempotent: true,
    name: "auditTodoCreated",
  }),

  // Workers
  worker("todo.notify", notifyTodoCompleted),
  worker("todo.notify.dlq", captureDlq, { dlq: false }),

  // Cron
  cron("backlog.snapshot", "*/15 * * * *", captureSnapshot),
];
```

## Decorator alternative

If you prefer a class-based style, use decorators and collect registrations with `registrationsFrom(...)`:

```ts
import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { Action, Subscription, Worker, Cron, registrationsFrom } from "@chimpbase/runtime";

class TodoModule {
  @Action("createTodo")
  async createTodo(ctx, input) { /* ... */ }

  @Subscription("todo.created")
  async auditTodoCreated(ctx, event) { /* ... */ }

  @Worker("todo.notify")
  async notifyTodoCompleted(ctx, payload) { /* ... */ }

  @Cron("backlog.snapshot", "*/15 * * * *")
  async captureSnapshot(ctx, invocation) { /* ... */ }
}

export default {
  project: { name: "my-app" },
  registrations: registrationsFrom(TodoModule),
} satisfies ChimpbaseAppDefinitionInput;
```
