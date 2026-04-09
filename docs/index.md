---
layout: home
hero:
  name: Chimpbase
  text: Build complex backends with fewer moving parts.
  tagline: PostgreSQL-backed backend primitives for software that needs more than request-response, without adding a distributed systems stack before it is necessary.
  actions:
    - theme: brand
      text: Get Started
      link: /auth
    - theme: alt
      text: GitHub
      link: https://github.com/chimpbase/chimpbase
features:
  - title: Actions
    details: Business operations that can be called from HTTP, CLI, workflows or other actions.
  - title: Workers & Queues
    details: Durable background execution with retries, dead letter queues, and configurable concurrency.
  - title: Subscriptions
    details: Internal pub/sub reactions with idempotency support for replay safety.
  - title: Cron
    details: Recurring work with smart backlog handling — resumes from the current slot after downtime.
  - title: Workflows
    details: Long-running business processes that survive time, restarts and retries.
  - title: Plugins
    details: Composable plugins for auth, webhooks, REST collections, and more.
---

## Quick Start

Install the Bun host:

```bash
bun add @chimpbase/bun
```

Start with PostgreSQL:

```ts
import { createChimpbase } from "@chimpbase/bun";

const chimpbase = await createChimpbase({
  storage: { engine: "postgres", url: process.env.DATABASE_URL! },
});
```

Register actions, workers, subscriptions and cron jobs:

```ts
chimpbase.register({ createCustomer });

chimpbase.register(
  worker("customer.sync", syncCustomer),
  cron("billing.rollup", "0 * * * *", runBillingRollup),
);
```

Then start the runtime:

```ts
await chimpbase.start();
```

## PostgreSQL First

Chimpbase uses PostgreSQL as both your application database and your coordination layer:

- application data in PostgreSQL
- queue state in PostgreSQL
- cron schedule state in PostgreSQL
- workflow state in PostgreSQL

SQLite and in-memory storage are available for local development and tests.
