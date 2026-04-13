# Just Use PostgreSQL

Most backend systems need more than request-response. They need background jobs, recurring tasks, durable retries, and long-running processes. The conventional answer is to add infrastructure: a message broker, a scheduler, a workflow engine.

But PostgreSQL can do all of that.

## One database, many roles

Chimpbase uses PostgreSQL as both your application database and your coordination layer:

- **Queue state** lives in PostgreSQL
- **Cron schedules** live in PostgreSQL
- **Workflow state** lives in PostgreSQL
- **Pub/sub event delivery** runs through PostgreSQL
- **Key-value storage** lives in PostgreSQL

Your application data and your operational state share the same database, the same backups, the same monitoring, and the same deployment.

## The infrastructure trap

A typical early-stage backend that needs background jobs, scheduled tasks, and event-driven flows often ends up with:

- An application server
- A message broker for async work
- A separate worker process consuming from the broker
- A cron service or scheduler
- A workflow engine for multi-step processes
- Glue code and retry logic connecting all of them

Each piece adds deployment complexity, monitoring surface, failure modes, and integration testing requirements. Before you've shipped the feature, you've shipped the infrastructure.

Chimpbase takes a different approach. Actions, subscriptions, workers, cron, and workflows all run in the same runtime and share the same database:

```
One runtime process
One PostgreSQL database
All primitives in the same codebase
```

No separate broker consumers, no external schedulers, no workflow services to deploy. The operational surface stays small while you figure out what your product actually needs.

## When to outgrow this

PostgreSQL is not the right answer forever. When you see:

- Throughput that exceeds what a single Postgres instance can handle
- Workloads that need stream semantics (Kafka, NATS)
- Multi-region coordination that needs a dedicated mesh

Then add the right tool for the job. But add it because the workload demands it, not because the framework required it from day one.

The cheapest infrastructure is the infrastructure you don't run yet.
