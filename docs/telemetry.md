# Telemetry

Chimpbase provides structured logging, metrics, and distributed tracing out of the box.

## Logging

```ts
ctx.log.debug("processing batch", { batchId: 42 });
ctx.log.info("order created", { orderId: 123, total: 99.99 });
ctx.log.warn("rate limit approaching", { current: 90, max: 100 });
ctx.log.error("payment failed", { orderId: 123, error: "card declined" });
```

All log methods accept an optional attributes object with structured key-value data.

## Metrics

```ts
ctx.metric("orders.created", 1, {
  projectSlug: "storefront",
  region: "us-east",
});

ctx.metric("order.total", 99.99, {
  currency: "USD",
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Metric name |
| `value` | `number` | Metric value |
| `labels` | `Record<string, string \| number \| boolean \| null>` | Optional labels |

## Tracing

Wrap operations in trace spans for distributed tracing:

```ts
const result = await ctx.trace("process.payment", async (span) => {
  span.setAttribute("order.id", orderId);
  span.setAttribute("amount", total);

  const charge = await chargeCard(total);
  span.setAttribute("charge.id", charge.id);

  return charge;
}, {
  provider: "stripe",
});
```

Traces can be nested — inner traces appear as child spans.

## Telemetry Persistence

By default, telemetry is logged to stdout. Enable persistence to store telemetry in streams:

```toml
[telemetry]
min_level = "info"    # "debug" | "info" | "warn" | "error"

[telemetry.persist]
log = true            # persist logs to stream
metric = true         # persist metrics to stream
trace = true          # persist traces to stream
```

### Retention

```toml
[telemetry.retention]
enabled = true
max_age_days = 30
schedule = "0 4 * * *"  # cleanup at 4 AM daily
```

## Per-Handler Control

Override telemetry at the handler level:

```ts
// Suppress all telemetry for a noisy action
action("pollStatus", handler, { telemetry: false });

// Enable only logging for a specific cron
cron("cleanup", "0 * * * *", handler, {
  telemetry: { log: true, metric: false, trace: false },
});
```

## Secrets

Access secrets from environment variables, `.env` files, or mounted secret directories:

```ts
const apiKey = ctx.secret("STRIPE_API_KEY");
const sender = ctx.secret("EMAIL_SENDER") ?? "noreply@example.com";
```

Secrets are loaded from environment variables, `.env` files, and mounted secret directories (e.g., `/run/secrets`).
