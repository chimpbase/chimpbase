# Configuration

Chimpbase is configured through your app definition (`chimpbase.app.ts`), environment variables, and optionally a `chimpbase.toml` file.

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

## chimpbase.toml

Full configuration reference:

```toml
[project]
name = "my-app"

[server]
port = 3000

[storage]
engine = "postgres"    # "postgres" | "sqlite" | "memory"
url = "postgresql://localhost/mydb"
path = "./data/app.db" # for sqlite

[worker]
concurrency = 4        # parallel workers (postgres only)
lease_ms = 30000
max_attempts = 5
poll_interval_ms = 250
retry_delay_ms = 1000

[subscriptions]
dispatch = "sync"      # "sync" | "async"

[subscriptions.idempotency.retention]
enabled = true
max_age_days = 30
schedule = "0 2 * * *"

[kv.retention]
enabled = false
schedule = "0 3 * * *"

[telemetry]
min_level = "info"

[telemetry.persist]
log = true
metric = true
trace = true

[telemetry.retention]
enabled = true
max_age_days = 30
schedule = "0 4 * * *"

[secrets]
env_file = ".env"
dir = "/run/secrets"

[workflows]
contracts_dir = "./workflow-contracts"
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHIMPBASE_STORAGE_ENGINE` | Storage engine | `sqlite` |
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
