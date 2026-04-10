# Subscriptions

Subscriptions react to events published via `ctx.pubsub.publish()`. Use them for internal choreography — audit logging, notifications, data denormalization, or enqueuing background work.

## Publishing Events

Any action, subscription, or worker handler can publish events:

```ts
ctx.pubsub.publish("order.created", { orderId: 42, total: 99.99 });
```

## Subscribing to Events

```ts
import { subscription } from "@chimpbase/runtime";

const onOrderCreated = subscription(
  "order.created",
  async (ctx, payload) => {
    await ctx.db.query(
      "INSERT INTO order_audit (order_id, event) VALUES (?1, ?2)",
      [payload.orderId, "created"],
    );
  },
  { idempotent: true, name: "auditOrderCreated" },
);
```

## Handler Signature

```ts
(ctx: ChimpbaseContext, payload: TPayload) => TResult | Promise<TResult>
```

The handler receives the full `ChimpbaseContext` and the event payload.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idempotent` | `boolean` | `false` | When `true`, the handler runs at most once per event (dedup via KV) |
| `name` | `string` | — | Required when `idempotent: true`. Used as the dedup key. |
| `telemetry` | `boolean \| object` | — | Control logging/metrics/tracing |

## Idempotency

Mark subscriptions as idempotent when replay safety matters. The framework stores a marker in KV after successful execution — if the same event is delivered again, the handler is skipped.

```ts
subscription("payment.captured", handlePayment, {
  idempotent: true,
  name: "processPaymentCapture",
});
```

Idempotency markers can be cleaned up via the retention cron configured in `chimpbase.toml`:

```toml
[subscriptions.idempotency.retention]
enabled = true
max_age_days = 30
schedule = "0 2 * * *"
```

## Dispatch Mode

Subscriptions can be dispatched synchronously or asynchronously, configured in `chimpbase.toml`:

```toml
[subscriptions]
dispatch = "sync"   # or "async"
```

- **sync** (default) — subscriptions run within the same transaction as the publisher
- **async** — subscriptions run asynchronously after the publisher completes

## Common Patterns

### Enqueue background work

```ts
subscription("todo.completed", async (ctx, todo) => {
  await ctx.queue.enqueue("todo.completed.notify", todo);
}, { idempotent: true, name: "enqueueTodoNotification" });
```

### Append to a stream

```ts
subscription("todo.created", async (ctx, todo) => {
  await ctx.stream.append("todo.activity", "todo.created", {
    todoId: todo.id,
    title: todo.title,
  });
}, { idempotent: true, name: "streamTodoCreated" });
```

### Multiple subscriptions per event

You can register multiple subscriptions for the same event:

```ts
subscription("order.created", auditOrder, { idempotent: true, name: "auditOrder" }),
subscription("order.created", notifyWarehouse, { idempotent: true, name: "notifyWarehouse" }),
subscription("order.created", updateAnalytics, { idempotent: true, name: "updateAnalytics" }),
```
