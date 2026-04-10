# HTTP Routes

Chimpbase supports two ways to handle HTTP requests: the `route()` primitive for framework-level routes, and the `httpHandler` for application-level routing with Hono.

## Using Hono (recommended for apps)

The `httpHandler` in your app definition accepts a Hono app instance:

```ts
import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

app.get("/projects", async (c) => {
  const projects = await c.env.action(listProjects);
  return c.json(projects);
});

app.post("/projects", async (c) => {
  const body = await c.req.json();
  const project = await c.env.action(createProject, body);
  return c.json(project, 201);
});

app.post("/todos/:id/complete", async (c) => {
  const todoId = Number(c.req.param("id"));
  const todo = await c.env.action(completeTodo, { todoId });
  return c.json(todo);
});

export { app as myApiApp };
```

Register in your app definition:

```ts
export default {
  httpHandler: myApiApp,
  registrations: [/* ... */],
} satisfies ChimpbaseAppDefinitionInput;
```

## Route Environment

Both Hono handlers (`c.env`) and route handlers receive a `ChimpbaseRouteEnv` with one method:

```ts
interface ChimpbaseRouteEnv {
  action(name: string, ...args: unknown[]): Promise<unknown>;
  action(reference: ActionRegistration, ...args): Promise<Result>;
}
```

Routes invoke business logic via actions — they don't have direct access to `db`, `kv`, `collection`, etc. This keeps HTTP handling separate from business logic.

## Using `route()` (for plugins)

The `route()` primitive registers a low-level route handler. This is primarily used by plugins (auth, webhooks, rest-collections) rather than application code.

```ts
import { route } from "@chimpbase/runtime";

const healthRoute = route("health", async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== "/status") {
    return null; // not my route — pass to next handler
  }

  const result = await env.action("getSystemStatus");
  return Response.json(result);
});
```

### Handler Signature

```ts
(request: Request, env: ChimpbaseRouteEnv) => Response | null | Promise<Response | null>
```

- Return a `Response` to handle the request
- Return `null` to pass the request to the next route handler

Routes are tried in registration order. The first non-null response wins.

## Route Execution Order

1. Registered `route()` handlers run in order
2. If no route matches, the `httpHandler` (Hono app) runs
3. If nothing matches, the server returns `404`

This is how the auth guard works — it registers a route that runs before everything else and returns `401` or `null` (pass-through).

## Built-in Endpoints

The framework provides a `/health` endpoint automatically:

```
GET /health → { "ok": true }
```

This runs before any registered routes and cannot be overridden.
