# examples/node/basic

Smallest runnable Chimpbase app on Node.js. Two actions + one HTTP route over SQLite. Zero plugins.

**Requires Node 22+** (uses built-in `node:sqlite`, stable `fetch`, native `--test` runner, stable `--import` loader).

## Run

```bash
bun install                      # at repo root
bun run dev:node:basic           # or: cd examples/node/basic && node --import tsx/esm app.ts
```

Server listens on port 3000 by default.

```bash
curl -X POST localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"alice@example.com","amount":4200}'

curl localhost:3000/orders
curl localhost:3000/health       # built-in: { "ok": true }
```

## What each file teaches

- **`chimpbase.migrations.ts`** — one SQLite migration. `defineChimpbaseMigrations` returns a definition the host replays on boot. `node:sqlite` powers local storage.
- **`chimpbase.app.ts`** — actions + `route()` + default-exported app definition. Identical to the Bun basic example: the runtime DSL is runtime-agnostic.
- **`app.ts`** — `createChimpbase` from `@chimpbase/node` accepts the same options. `projectDir` via `fileURLToPath(new URL(".", import.meta.url))` is the Node equivalent of Bun's `import.meta.dir`.
- **`tests/app.test.ts`** — `node:test` + `node:assert/strict`. Boots the host with `storage: { engine: "memory" }`, drives `POST /orders` + `GET /orders`, confirms the built-in `/health`.

## Why tsx

Node's `@chimpbase/node` package only exports its compiled `dist/` output. Loading the workspace source directly via `node --import tsx/esm app.ts` lets the `tsconfig.json` path alias (`@chimpbase/node` → `packages/node/src/library.ts`) resolve during development without a build step.

## Next steps

- `examples/node/intermediate` — subscriptions, workers, cron, Postgres.
- `examples/node/advanced` — workflows, plugins, multi-replica Docker Compose.
