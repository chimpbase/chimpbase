# Getting Started

Chimpbase is a PostgreSQL-backed runtime for building backends that need more than request-response — background jobs, durable queues, cron schedules, workflows — without adding a distributed systems stack before it's necessary.

## Install

Choose your runtime:

::: code-group

```bash [Bun]
bun add @chimpbase/bun
```

```bash [Deno]
deno add npm:@chimpbase/deno
```

```bash [Node]
npm install @chimpbase/node
```

:::

## Create Your App

Create a `chimpbase.app.ts`:

```ts
import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { action, v } from "@chimpbase/runtime";

const createCustomer = action({
  name: "createCustomer",
  args: v.object({
    email: v.string(),
    name: v.string(),
  }),
  async handler(ctx, input) {
    const [customer] = await ctx.db.query<{ id: number }>(
      "INSERT INTO customers (email, name) VALUES (?1, ?2) RETURNING id",
      [input.email, input.name],
    );

    ctx.pubsub.publish("customer.created", {
      customerId: customer.id,
      email: input.email,
    });

    return customer;
  },
});

export default {
  project: { name: "my-app" },
  migrations: {
    sqlite: [{
      name: "001_init",
      sql: "CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT NOT NULL)",
    }],
  },
  registrations: [createCustomer],
} satisfies ChimpbaseAppDefinitionInput;
```

## Start the Server

Create an `app.ts` entry point:

```ts
import { createChimpbase } from "@chimpbase/bun";
import app from "./chimpbase.app.ts";

const chimpbase = await createChimpbase({
  ...app,
  projectDir: import.meta.dir,
});

await chimpbase.start();
```

Run it:

```bash
bun run app.ts
```

The server starts on port 3000 with a `/health` endpoint and a background worker.

## Add HTTP Routes

Use [Hono](https://hono.dev) for HTTP routing:

```bash
bun add hono
```

```ts
import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

app.post("/customers", async (c) => {
  const body = await c.req.json();
  const customer = await c.env.action("createCustomer", body);
  return c.json(customer, 201);
});

export { app as httpApp };
```

Then set it as the `httpHandler` in your app definition:

```ts
import { httpApp } from "./http.ts";

export default {
  httpHandler: httpApp,
  // ...
} satisfies ChimpbaseAppDefinitionInput;
```

## Choose a Storage Engine

### SQLite (development)

Default — no configuration needed. Data stored in `data/{project-name}.db`.

### PostgreSQL (production)

```ts
const chimpbase = await createChimpbase({
  ...app,
  storage: { engine: "postgres", url: process.env.DATABASE_URL! },
});
```

Or set the environment variable:

```bash
CHIMPBASE_STORAGE_ENGINE=postgres
DATABASE_URL=postgresql://localhost/mydb
```

### Memory (testing)

```ts
const chimpbase = await createChimpbase({
  ...app,
  storage: { engine: "memory" },
});
```

## What's Next

- [Actions](/actions) — define business operations
- [Subscriptions](/subscriptions) — react to events
- [Workers & Queues](/workers) — durable background jobs
- [Cron](/cron) — scheduled tasks
- [Workflows](/workflows) — long-running processes
- [HTTP Routes](/routes) — handle HTTP requests with Hono
- [Database](/database) — raw SQL and Kysely
- [Configuration](/configuration) — environment variables and app definition options

### Plugins

- [Auth](/auth) — API key authentication, user management, scopes, rate limiting
- [Webhooks](/webhooks) — outbound + inbound webhooks with HMAC
- [REST Collections](/rest-collections) — expose collections as REST APIs
