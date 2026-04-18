# examples/deno/basic

Smallest runnable Chimpbase app on Deno. Two actions + one HTTP route over SQLite. Zero plugins.

**Requires Deno 2.0+** (`node:sqlite` built-in, stable `fetch`, `Deno.serve`).

## Run

```bash
cd examples/deno/basic
deno task dev
```

Or from the repo root:

```bash
bun run dev:deno:basic
```

Server listens on port 3000 by default.

```bash
curl -X POST localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"alice@example.com","amount":4200}'

curl localhost:3000/orders
curl localhost:3000/health       # built-in: { "ok": true }
```

## Tests

```bash
cd examples/deno/basic
deno task test
```

## Why this example lives outside the Bun workspace

Deno does not participate in the root `package.json` workspace. Instead, `deno.json` carries an `imports` map that resolves `@chimpbase/*` to the workspace source in `../../../packages/*` and npm specifiers (`pg`, `kysely`) to Deno's npm compatibility layer. `nodeModulesDir: "auto"` lets Deno hydrate a local `node_modules/` so the Postgres driver can read native bindings if Postgres storage is selected.

## Next steps

- `examples/deno/intermediate` — subscriptions, workers, cron, Postgres.
- `examples/deno/advanced` — workflows, plugins, multi-replica Docker Compose.
