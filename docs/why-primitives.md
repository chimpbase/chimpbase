# Explicit Primitives

Chimpbase gives you a small set of named primitives instead of a large framework abstraction. Each one does one thing and has a clear contract.

## The primitives

| Primitive | What it does |
|-----------|-------------|
| `action(...)` | A business operation. Called from HTTP, CLI, workflows, or other actions. |
| `subscription(...)` | Reacts to an internal event. Decouples producers from consumers. |
| `worker(...)` | Processes a durable background job with retries. |
| `cron(...)` | Runs on a recurring schedule. |
| `workflow(...)` | A long-running process that survives restarts, delays, and signals. |
| `route(...)` | An HTTP request handler using standard Web APIs. |
| `plugin(...)` | Groups registrations into reusable modules with dependency management. |

No base classes, no lifecycle hooks, no convention-over-configuration. You import a function, call it, and register the result.

## Composition over convention

A Chimpbase app is a list of registrations:

```ts
const registrations = [
  createCustomer,
  subscription("customer.created", auditCustomer, {
    idempotent: true,
    name: "auditCustomer",
  }),
  worker("customer.sync", syncCustomer),
  cron("reports.daily", "0 9 * * *", generateReport),
];
```

You can read the full list of everything your app does in one place. There's no scanning, no auto-discovery, no decorators required (though they're available if you want them).

## Why this matters

When something goes wrong at 2am, you want to be able to read the code and understand what it does. Explicit registration means:

- **Greppable** — search for a queue name and find exactly where it's enqueued and consumed
- **Traceable** — follow the flow from an action to a published event to a subscription to an enqueued job to a worker
- **Deletable** — remove a registration and know exactly what stopped running

No framework magic means fewer surprises.
