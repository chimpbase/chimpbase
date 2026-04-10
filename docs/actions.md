# Actions

Actions are the core unit of business logic in Chimpbase. They can be called from HTTP routes, other actions, subscriptions, workers, workflows, and the CLI.

## Defining Actions

### Simple (tuple args)

```ts
import { action } from "@chimpbase/runtime";

const greetUser = action("greetUser", async (ctx, name: string) => {
  ctx.log.info("greeting user", { name });
  return { message: `Hello, ${name}!` };
});
```

### With validation (object args)

```ts
import { action, v } from "@chimpbase/runtime";

const createTodo = action({
  name: "createTodo",
  args: v.object({
    title: v.string(),
    projectSlug: v.string(),
    priority: v.optional(v.string()),
    assigneeEmail: v.optional(v.union(v.string(), v.null())),
  }),
  async handler(ctx, input) {
    const [todo] = await ctx.db.query(
      "INSERT INTO todos (title, project_slug, priority, assignee_email) VALUES (?1, ?2, ?3, ?4) RETURNING *",
      [input.title, input.projectSlug, input.priority ?? "medium", input.assigneeEmail ?? null],
    );

    ctx.pubsub.publish("todo.created", todo);
    return todo;
  },
});
```

## Handler Signature

Every action handler receives a `ChimpbaseContext` as its first argument:

```ts
(ctx: ChimpbaseContext, ...args) => TResult | Promise<TResult>
```

The context provides access to all Chimpbase primitives:

| Property | Type | Description |
|----------|------|-------------|
| `ctx.db` | `ChimpbaseDbClient` | Raw SQL + Kysely queries |
| `ctx.collection` | `ChimpbaseCollectionClient` | Document CRUD |
| `ctx.kv` | `ChimpbaseKvClient` | Key-value store |
| `ctx.stream` | `ChimpbaseStreamClient` | Append-only event streams |
| `ctx.queue` | `ChimpbaseQueueClient` | Enqueue worker jobs |
| `ctx.workflow` | `ChimpbaseWorkflowClient` | Start/signal workflows |
| `ctx.pubsub` | `ChimpbasePubSubClient` | Publish events |
| `ctx.log` | `ChimpbaseLogger` | Structured logging |
| `ctx.metric()` | method | Record metrics |
| `ctx.trace()` | method | Distributed tracing |
| `ctx.secret()` | method | Read secrets |
| `ctx.action()` | method | Call other actions |

## Calling Actions

### From another action

```ts
const dashboard = action("getDashboard", async (ctx) => {
  const todos = await ctx.action("listTodos", { status: "backlog" });
  return { backlog: todos.length };
});
```

### From an HTTP route

```ts
app.post("/todos", async (c) => {
  const body = await c.req.json();
  const todo = await c.env.action(createTodo, body);
  return c.json(todo, 201);
});
```

### Using action references

When you store an action in a variable, you can pass the reference directly instead of using a string name:

```ts
const result = await ctx.action(createTodo, { title: "Ship it", projectSlug: "core" });
```

## Telemetry

Control per-action telemetry persistence:

```ts
const noisyAction = action("pollStatus", async (ctx) => {
  // ...
}, { telemetry: false }); // suppress all telemetry

const importantAction = action("chargeCustomer", async (ctx) => {
  // ...
}, { telemetry: { log: true, metric: true, trace: true } });
```

## Validators

The `v` namespace provides runtime input validation:

```ts
import { v } from "@chimpbase/runtime";

v.string()                          // string
v.number()                          // number
v.boolean()                         // boolean
v.null()                            // null
v.unknown()                         // unknown
v.optional(v.string())              // string | undefined
v.nullable(v.string())              // string | null
v.array(v.string())                 // string[]
v.union(v.string(), v.null())       // string | null
v.enum(["low", "medium", "high"])   // "low" | "medium" | "high"
v.literal("active")                 // "active"
v.object({ name: v.string() })      // { name: string }
```

Invalid input throws a validation error before the handler runs.

## Registration

Actions are registered in the `registrations` array of your app definition:

```ts
export default {
  project: { name: "my-app" },
  registrations: [
    createTodo,
    listTodos,
    getDashboard,
  ],
} satisfies ChimpbaseAppDefinitionInput;
```
