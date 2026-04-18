# examples/bun/basic

The smallest runnable Chimpbase app on Bun. Two actions + one HTTP route over SQLite. Zero plugins.

## Run

```bash
bun install                      # at repo root
bun run dev:bun:basic            # or: cd examples/bun/basic && bun run app.ts
```

The server listens on port 3000 by default (override via `PORT`).

```bash
curl -X POST localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"alice@example.com","amount":4200}'

curl localhost:3000/orders
curl localhost:3000/health          # built-in: { "ok": true }
```

## What each file teaches

- **`chimpbase.migrations.ts`** — one SQLite migration. `defineChimpbaseMigrations` returns a definition the host replays on boot.
- **`chimpbase.app.ts`** — the app surface:
  - `action(...)` declares a typed, transactional RPC. Validated input (`v.object(...)`), `ctx.db.query(...)` for SQL, returned value is the RPC result.
  - `route(...)` declares a raw HTTP handler. The handler gets `(request, env)` where `env.action(...)` invokes registered actions with full validation.
  - `export default { migrations, project, registrations }` is the app definition shape every Chimpbase project shares.
- **`app.ts`** — bootstrap. `createChimpbase({...app, storage, projectDir})` creates the host, `start()` runs migrations and serves HTTP.
- **`tests/app.test.ts`** — one e2e exercising the HTTP surface. Uses `storage: { engine: "memory" }` so tests leave no files behind.

## Next steps

- `examples/bun/intermediate` — add subscriptions, workers, cron, Postgres.
- `examples/bun/advanced` — workflows, plugins, multi-replica Docker Compose.
