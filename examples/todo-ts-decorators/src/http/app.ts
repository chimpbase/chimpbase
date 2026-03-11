import {
  type ChimpbaseRouteEnv,
  type InferActionsFromModules,
} from "@chimpbase/runtime";
import { Hono } from "hono";

import type { ProjectModule } from "../modules/projects/project.module.ts";
import type { TodoModule } from "../modules/todos/todo.module.ts";
import type {
  CreateProjectInput,
} from "../modules/projects/project.types.ts";
import type {
  CreateTodoInput,
  TodoListFilters,
} from "../modules/todos/todo.types.ts";

type TodoActions = InferActionsFromModules<[
  typeof ProjectModule,
  typeof TodoModule,
]>;

type TodoRouteBindings = ChimpbaseRouteEnv<TodoActions>;

const app = new Hono<{ Bindings: TodoRouteBindings }>();

app.get("/projects", async (context) => {
  const projects = await context.env.action("listProjects");
  return context.json(projects);
});

app.post("/projects", async (context) => {
  const body = await context.req.json<CreateProjectInput>();
  const project = await context.env.action(
    "createProject",
    body,
  );
  return context.json(project, 201);
});

app.post("/seed", async (context) => {
  const workspace = await context.env.action("seedDemoWorkspace");
  return context.json(workspace, 201);
});

app.get("/todos", async (context) => {
  const filters: TodoListFilters = {
    projectSlug: context.req.query("projectSlug") ?? undefined,
    status: context.req.query("status") ?? undefined,
    priority: context.req.query("priority") ?? undefined,
    assigneeEmail: context.req.query("assigneeEmail") ?? undefined,
    search: context.req.query("search") ?? undefined,
  };
  const todos = await context.env.action("listTodos", filters);
  return context.json(todos);
});

app.post("/todos", async (context) => {
  const body = await context.req.json<CreateTodoInput>();
  const todo = await context.env.action("createTodo", body);
  return context.json(todo, 201);
});

app.post("/todos/:id/assign", async (context) => {
  const body = await context.req.json<{ assigneeEmail: string }>();
  const todoId = Number(context.req.param("id"));
  const todo = await context.env.action(
    "assignTodo",
    todoId,
    body.assigneeEmail,
  );
  return context.json(todo);
});

app.post("/todos/:id/start", async (context) => {
  const todoId = Number(context.req.param("id"));
  const todo = await context.env.action("startTodo", todoId);
  return context.json(todo);
});

app.post("/todos/:id/complete", async (context) => {
  const todoId = Number(context.req.param("id"));
  const todo = await context.env.action("completeTodo", todoId);
  return context.json(todo);
});

app.get("/dashboard", async (context) => {
  const projectSlug = context.req.query("projectSlug") ?? null;
  const dashboard = await context.env.action(
    "getTodoDashboard",
    projectSlug,
  );
  return context.json(dashboard);
});

app.get("/audit-log", async (context) => {
  const auditLog = await context.env.action("listTodoAuditLog");
  return context.json(auditLog);
});

app.get("/events", async (context) => {
  const events = await context.env.action("listTodoEvents");
  return context.json(events);
});

app.get("/notifications", async (context) => {
  const notifications = await context.env.action("listTodoNotifications");
  return context.json(notifications);
});

app.get("/preferences", async (context) => {
  const preferences = await context.env.action("listWorkspacePreferences");
  return context.json(preferences);
});

app.put("/preferences/:key", async (context) => {
  const value = await context.req.json<unknown>();
  const preference = await context.env.action(
    "setWorkspacePreference",
    context.req.param("key"),
    value,
  );
  return context.json(preference);
});

app.post("/todo-notes", async (context) => {
  const body = await context.req.json<{ body: string; todoId: number }>();
  const note = await context.env.action("addTodoNote", body);
  return context.json(note, 201);
});

app.get("/todo-notes", async (context) => {
  const todoId = Number(context.req.query("todoId"));
  const notes = await context.env.action("listTodoNotes", todoId);
  return context.json(notes);
});

app.get("/activity-stream", async (context) => {
  const events = await context.env.action(
    "listTodoActivityStream",
    {
      limit: context.req.query("limit") ? Number(context.req.query("limit")) : undefined,
      sinceId: context.req.query("sinceId") ? Number(context.req.query("sinceId")) : undefined,
      stream: context.req.query("stream") ?? undefined,
    },
  );
  return context.json(events);
});

const todoApiApp = app;

export { todoApiApp };
