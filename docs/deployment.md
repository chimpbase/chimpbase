# Deployment

A single Chimpbase process runs everything — HTTP, workers, cron, and subscriptions. As your workload grows, you can split these responsibilities across multiple containers while sharing the same PostgreSQL database.

## Single process (default)

The simplest deployment is a single container that does everything:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  app:
    build: .
    environment:
      DATABASE_URL: postgres://myapp:secret@postgres:5432/myapp
    ports:
      - "3000:3000"
    depends_on:
      - postgres

volumes:
  pgdata:
```

This single `app` container handles HTTP requests, processes background jobs, runs cron schedules, and delivers subscription events. For many workloads, this is enough.

## Scaling workers

When background jobs need more throughput, add dedicated worker containers. Since queue coordination happens through PostgreSQL, multiple containers can safely poll the same queues:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build: .
    environment:
      DATABASE_URL: postgres://myapp:secret@postgres:5432/myapp
      CHIMPBASE_SERVER_PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres

  worker:
    build: .
    environment:
      DATABASE_URL: postgres://myapp:secret@postgres:5432/myapp
      CHIMPBASE_WORKER_CONCURRENCY: 10
      CHIMPBASE_WORKER_POLL_INTERVAL_MS: 500
    deploy:
      replicas: 3
    depends_on:
      - postgres

volumes:
  pgdata:
```

All containers run the same `chimpbase.app.ts`. The worker replicas pick up jobs from the shared PostgreSQL queue — no broker needed.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `CHIMPBASE_SERVER_PORT` | `3000` | HTTP server port |
| `CHIMPBASE_STORAGE_ENGINE` | auto | `postgres`, `sqlite`, or `memory` |
| `CHIMPBASE_WORKER_CONCURRENCY` | — | Max concurrent jobs per container |
| `CHIMPBASE_WORKER_POLL_INTERVAL_MS` | — | How often workers poll for new jobs |
| `CHIMPBASE_WORKER_LEASE_MS` | — | Job lease duration before retry |

## Why this works

Chimpbase uses PostgreSQL for all coordination:

- **Queues** use row-level locking — multiple workers safely dequeue without duplicates
- **Cron schedules** are durable — only one container fires each scheduled slot
- **Subscriptions** with `idempotent: true` deduplicate across processes
- **Workflows** persist state in PostgreSQL — any container can resume a workflow
- **KV**, **Collections**, and **Streams** are stored in PostgreSQL — reads and writes from any replica see the same data immediately

No separate broker, no leader election service, no external scheduler. PostgreSQL handles it.

## Scaling further

When a single PostgreSQL instance becomes the bottleneck:

- Add read replicas for query-heavy actions
- Move high-throughput queues to a dedicated broker
- Shard workflows by tenant or domain

But start here. One database, N containers, and the same `chimpbase.app.ts` everywhere.

## Working example

The [`factory-controller`](https://github.com/chimpbase/chimpbase/tree/main/examples/bun/factory-controller) example runs 3 replicas via Docker Compose with a shared PostgreSQL database. It exercises actions, idempotent subscriptions, workers, queues, cron, KV, collections, streams, and telemetry — all coordinating across replicas.
