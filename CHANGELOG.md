# Changelog

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
- `ctx.db()` backed by Kysely while keeping `ctx.query()` available
- schema generation and schema check commands for Postgres migrations
- Bun examples under `examples/bun/*`

### Release model

- packages are published from the monorepo
- package dependencies use Bun workspaces and are rewritten on publish
- `0.1.0` intentionally ships TypeScript source instead of a prebuilt `dist/` directory
- release verification runs through `bun run release:check`
