# Configuration

Chimpbase is configured through your app definition (`chimpbase.app.ts`) and environment variables.

## App Definition

The main entry point is your `chimpbase.app.ts`:

```ts
import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";

export default {
  project: { name: "my-app" },
  httpHandler: myHonoApp,
  migrations: { /* ... */ },
  registrations: [ /* actions, workers, subscriptions, crons, plugins */ ],
  worker: {
    maxAttempts: 5,
    retryDelayMs: 1000,
  },
  telemetry: {
    minLevel: "info",
    persist: { log: true, metric: true, trace: true },
  },
  workflows: {
    contractsDir: "./workflow-contracts",
  },
} satisfies ChimpbaseAppDefinitionInput;
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHIMPBASE_STORAGE_ENGINE` | Storage engine (`postgres`, `sqlite`, `memory`) | `sqlite` |
| `CHIMPBASE_DATABASE_URL` or `DATABASE_URL` | PostgreSQL connection URL | — |
| `CHIMPBASE_STORAGE_PATH` | SQLite file path | `data/{name}.db` |
| `CHIMPBASE_WORKER_CONCURRENCY` | Worker concurrency | `1` |
| `CHIMPBASE_WORKER_POLL_INTERVAL_MS` | Worker poll interval | `250` |
| `CHIMPBASE_WORKER_LEASE_MS` | Worker lease duration | `30000` |
| `CHIMPBASE_ENV_FILE` | Path to `.env` file | `.env` |
| `CHIMPBASE_SECRETS_DIR` | Path to secrets directory | `/run/secrets` |

## Storage Engines

### PostgreSQL (recommended for production)

```ts
const chimpbase = await createChimpbase({
  storage: { engine: "postgres", url: process.env.DATABASE_URL! },
});
```

Supports concurrent workers, event bus coordination across instances, and is the recommended choice for production.

### SQLite (development)

```ts
const chimpbase = await createChimpbase({
  storage: { engine: "sqlite" },
  // path defaults to data/{project-name}.db
});
```

Single-process only. Good for development and testing.

### Memory (testing)

```ts
const chimpbase = await createChimpbase({
  storage: { engine: "memory" },
});
```

Data is lost on restart. Used for unit tests.

## Runtime Hosts

| Runtime | Package | Install |
|---------|---------|---------|
| Bun | `@chimpbase/bun` | `bun add @chimpbase/bun` |
| Deno | `@chimpbase/deno` | `deno add npm:@chimpbase/deno` |
| Node | `@chimpbase/node` | `npm install @chimpbase/node` |

## Starting the Server

```ts
import { createChimpbase } from "@chimpbase/bun";
import app from "./chimpbase.app.ts";

const chimpbase = await createChimpbase({ ...app, projectDir: import.meta.dir });
await chimpbase.start(); // starts HTTP server + worker
```

Options for `start()`:

```ts
chimpbase.start({
  serve: true,      // start HTTP server (default: true)
  runWorker: true,   // start background worker (default: true)
});
```
