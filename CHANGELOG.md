# Changelog

## 0.1.4 - 2026-03-11

Adds optional telemetry stream persistence for `ctx.log`, `ctx.metric` and `ctx.trace`.

### Added

- added opt-in telemetry persistence via `telemetry.persist` in `createChimpbase` config
- telemetry records are buffered during handler execution and batch-appended to dedicated streams (`_chimpbase.logs`, `_chimpbase.metrics`, `_chimpbase.traces`)
- added `minLevel` filter to skip debug/info logs when persisting (e.g. only persist `warn` and `error`)
- added per-handler telemetry override via `{ telemetry }` option on `action()`, `worker()`, `subscription()` and `cron()` factories
- added automatic cleanup cron (`__chimpbase.telemetry.cleanup`) with configurable retention period and schedule
- added telemetry persistence test coverage

## 0.1.3 - 2026-03-11

Adds the first durable cron primitive to the alpha runtime surface.

### Added

- added `cron(...)`, `defineCron(...)` and `@Cron(...)` to `@chimpbase/runtime`
- added durable cron schedule orchestration to the core engine and Bun host
- added SQLite and Postgres persistence for cron schedules and scheduled runs
- added runtime and integration coverage proving the next fire time advances before handler retries
- added cron documentation and a concrete backlog snapshot example in `examples/bun/todo-ts`

## 0.1.2 - 2026-03-11

Big-bang alpha naming cleanup across the durable primitives.

### Changed

- renamed durable queue handlers from `queue(...)` / `@Queue(...)` to `worker(...)` / `@Worker(...)`
- renamed job dispatch from `ctx.queue.send(...)` to `ctx.queue.enqueue(...)`
- renamed durable stream writes from `ctx.stream.publish(...)` to `ctx.stream.append(...)`
- updated examples, docs and tests to use the new queue and stream vocabulary consistently

## 0.1.1 - 2026-03-11

Refines the alpha API surface without changing the overall release model.

### Changed

- renamed the ephemeral event API from `emit`/`listener` to `ctx.pubsub.publish(...)` and `subscription(...)`
- renamed the decorator API from `@Listener(...)` to `@Subscription(...)`
- updated examples, docs and tests to use the new pub/sub naming consistently

## 0.1.0 - 2026-03-11

Initial public alpha release of the Chimpbase monorepo.

### Added

- `@chimpbase/bun` as the Bun host package
- `@chimpbase/runtime` with actions, listeners, queues and durable workflow primitives
- `@chimpbase/core` with the execution engine and host contracts
- Postgres-first runtime support with SQLite support for local development and tests
- durable workflows with versioned workflow contracts
- `ctx.db.kysely()` backed by Kysely while keeping `ctx.db.query()` available
- schema generation and schema check commands for Postgres migrations
- Bun examples under `examples/bun/*`

### Release model

- packages are published from the monorepo
- package dependencies use Bun workspaces and are rewritten on publish
- `0.1.0` intentionally ships TypeScript source instead of a prebuilt `dist/` directory
- release verification runs through `bun run release:check`
