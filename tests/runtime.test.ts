import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createChimpbase } from "../src/library.ts";
import { ChimpbaseBunHost } from "../src/runtime.ts";

const runtimeRoot = resolve(import.meta.dir, "..");
const exampleDir = resolve(runtimeRoot, "examples/todo-ts");
const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("chimpbase-bun runtime", () => {
  test("applies createChimpbase defaults from environment", async () => {
    const previousEnv = {
      CHIMPBASE_PROJECT_NAME: process.env.CHIMPBASE_PROJECT_NAME,
      CHIMPBASE_SERVER_PORT: process.env.CHIMPBASE_SERVER_PORT,
      CHIMPBASE_STORAGE_ENGINE: process.env.CHIMPBASE_STORAGE_ENGINE,
      CHIMPBASE_STORAGE_PATH: process.env.CHIMPBASE_STORAGE_PATH,
      CHIMPBASE_WORKER_LEASE_MS: process.env.CHIMPBASE_WORKER_LEASE_MS,
      CHIMPBASE_WORKER_MAX_ATTEMPTS: process.env.CHIMPBASE_WORKER_MAX_ATTEMPTS,
      CHIMPBASE_WORKER_POLL_INTERVAL_MS: process.env.CHIMPBASE_WORKER_POLL_INTERVAL_MS,
      CHIMPBASE_WORKER_RETRY_DELAY_MS: process.env.CHIMPBASE_WORKER_RETRY_DELAY_MS,
    };
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-env-defaults-"));
    cleanupDirs.push(projectDir);

    process.env.CHIMPBASE_PROJECT_NAME = "env-app";
    process.env.CHIMPBASE_SERVER_PORT = "4310";
    process.env.CHIMPBASE_STORAGE_ENGINE = "memory";
    process.env.CHIMPBASE_STORAGE_PATH = "ignored.db";
    process.env.CHIMPBASE_WORKER_LEASE_MS = "41000";
    process.env.CHIMPBASE_WORKER_MAX_ATTEMPTS = "7";
    process.env.CHIMPBASE_WORKER_POLL_INTERVAL_MS = "500";
    process.env.CHIMPBASE_WORKER_RETRY_DELAY_MS = "1200";

    try {
      const host = await createChimpbase.from(projectDir, {});

      expect(host.config.project.name).toBe("env-app");
      expect(host.config.server.port).toBe(4310);
      expect(host.config.storage.engine).toBe("memory");
      expect(host.config.storage.path).toBeNull();
      expect(host.config.worker).toEqual({
        leaseMs: 41000,
        maxAttempts: 7,
        pollIntervalMs: 500,
        retryDelayMs: 1200,
      });

      host.close();
    } finally {
      restoreEnv(previousEnv);
    }
  });

  test("executes actions against the todo-ts example", async () => {
    const projectDir = await createFixture("action");
    const host = await ChimpbaseBunHost.load(projectDir);

    const outcome = await host.executeAction("seedDemoWorkspace");
    const projects = await host.executeAction("listProjects");

    expect(outcome.emittedEvents).toHaveLength(3);
    expect((projects.result as Array<{ slug: string }>)[0].slug).toBe("operations-platform");

    host.close();
  });

  test("executes routes with Hono app.fetch", async () => {
    const projectDir = await createFixture("route");
    const host = await ChimpbaseBunHost.load(projectDir);

    await host.executeAction("seedDemoWorkspace");

    const createResponse = await host.executeRoute(
      new Request("http://todo.test/todos", {
        body: JSON.stringify({
          assigneeEmail: "sre@chimpbase.dev",
          description: "Validate Bun runtime host.",
          dueDate: "2026-03-24",
          priority: "high",
          projectSlug: "operations-platform",
          title: "Run chimpbase-bun route test",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(createResponse.response?.status).toBe(201);
    expect(createResponse.emittedEvents).toHaveLength(1);

    const listResponse = await host.executeRoute(
      new Request("http://todo.test/todos?projectSlug=operations-platform"),
    );
    const todos = await listResponse.response?.json() as Array<{ title: string }>;

    const auditLog = await host.executeAction("listTodoAuditLog");
    expect((auditLog.result as Array<{ event_name: string }>).some((entry) => entry.event_name === "todo.created")).toBe(true);

    expect(todos.some((todo) => todo.title === "Run chimpbase-bun route test")).toBe(true);

    host.close();
  });

  test("processes queue jobs with secrets and telemetry", async () => {
    const previousSender = process.env.TODO_NOTIFIER_SENDER;
    process.env.TODO_NOTIFIER_SENDER = "alerts@chimpbase.dev";

    try {
      const projectDir = await createFixture("queue");
      const host = await ChimpbaseBunHost.load(projectDir);

      await host.executeAction("seedDemoWorkspace");
      const createdTodo = await host.executeAction("createTodo", [
        {
          assigneeEmail: "queue-owner@chimpbase.dev",
          description: "Ship queue support for Bun.",
          dueDate: "2026-03-30",
          priority: "high",
          projectSlug: "operations-platform",
          title: "Queue-backed completion notification",
        },
      ]);

      const todoId = (createdTodo.result as { id: number }).id;
      await host.executeAction("startTodo", [todoId]);
      await host.executeAction("completeTodo", [todoId]);
      const queueResult = await host.processNextQueueJob();

      expect(queueResult?.queueName).toBe("todo.completed.notify");

      const notifications = await host.executeAction("listTodoNotifications");
      expect(notifications.result).toEqual([
        expect.objectContaining({
          queue_name: "todo.completed.notify",
          sender_email: "alerts@chimpbase.dev",
          todo_id: todoId,
        }),
      ]);

      const telemetry = host.drainTelemetryRecords();
      expect(telemetry.some((entry) => entry.kind === "log" && entry.message === "processing todo completion notification")).toBe(true);
      expect(telemetry.some((entry) => entry.kind === "metric" && entry.name === "todo.notifications.delivered")).toBe(true);
      expect(telemetry.some((entry) => entry.kind === "trace" && entry.name === "todo.completed.notify" && entry.phase === "start")).toBe(true);
      expect(telemetry.some((entry) => entry.kind === "trace" && entry.name === "todo.completed.notify" && entry.phase === "end" && entry.status === "ok")).toBe(true);

      host.close();
    } finally {
      if (previousSender === undefined) {
        delete process.env.TODO_NOTIFIER_SENDER;
      } else {
        process.env.TODO_NOTIFIER_SENDER = previousSender;
      }
    }
  });

  test("routes failed jobs to a custom dlq", async () => {
    const projectDir = await createInlineFixture("dlq", {
      "index.ts": [
        'import { action, queue, registerChimpbaseEntries } from "@chimpbase/runtime";',
        "",
        'const entries = [',
        'action("enqueueExplodingJob", async (ctx) => {',
        '  await ctx.queue.send("todo.explodes", { todoId: 7 });',
        "  return null;",
        "}),",
        "",
        'queue("todo.explodes", async () => {',
        '  throw new Error("boom");',
        "}, {",
        '  dlq: "todo.explodes.failed"',
        "}),",
        "",
        'queue("todo.explodes.failed", async (ctx, envelope) => {',
        "  await ctx.query(",
        '    "INSERT INTO dlq_captures (queue_name, error_message, attempts) VALUES (?1, ?2, ?3)",',
        "    [envelope.queue, envelope.error, envelope.attempts],",
        "  );",
        "}, {",
        "  dlq: false,",
        "}),",
        "",
        'action("listDlqCaptures", async (ctx) => {',
        '  return await ctx.query("SELECT queue_name, error_message, attempts FROM dlq_captures ORDER BY id ASC");',
        "}),",
        "];",
        'registerChimpbaseEntries({',
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerListener(name, handler) { return globalThis.defineListener(name, handler); },',
        '  registerQueue(name, handler, definition) { return globalThis.defineQueue(name, handler, definition); },',
        '}, entries);',
      ].join("\n"),
      "migrations/001_init.sql": [
        "CREATE TABLE IF NOT EXISTS dlq_captures (",
        "  id INTEGER PRIMARY KEY,",
        "  queue_name TEXT NOT NULL,",
        "  error_message TEXT NOT NULL,",
        "  attempts INTEGER NOT NULL",
        ");",
      ].join("\n"),
    }, [
      "[project]",
      'name = "dlq-test"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/test.db"',
      "",
      "[worker]",
      "max_attempts = 2",
      "retry_delay_ms = 0",
      "",
    ]);
    const host = await ChimpbaseBunHost.load(projectDir);

    await host.executeAction("enqueueExplodingJob");
    await expect(host.processNextQueueJob()).rejects.toThrow("boom");
    await expect(host.processNextQueueJob()).rejects.toThrow("boom");

    const dlqJob = await host.processNextQueueJob();
    expect(dlqJob?.queueName).toBe("todo.explodes.failed");

    const captures = await host.executeAction("listDlqCaptures");
    expect(captures.result).toEqual([
      {
        attempts: 2,
        error_message: "boom",
        queue_name: "todo.explodes",
      },
    ]);

    host.close();
  });

  test("registers actions, listeners and queues with decorators", async () => {
    const projectDir = await createInlineFixture("decorators", {
      "index.ts": [
        'import { Action, Listener, Queue, registerDecoratedEntries } from "@chimpbase/runtime";',
        "",
        "class DecoratedTodoModule {",
        '  @Action("createDecoratedTodo")',
        "  static async create(ctx, title) {",
        '    await ctx.query("INSERT INTO decorated_todos (title) VALUES (?1)", [title]);',
        '    const [todo] = await ctx.query("SELECT id, title FROM decorated_todos WHERE id = last_insert_rowid() LIMIT 1");',
        '    ctx.emit("decorated.created", todo);',
        "    return todo;",
        "  }",
        "",
        '  @Listener("decorated.created")',
        "  static async onCreated(ctx, todo) {",
        '    await ctx.queue.send("decorated.audit", todo);',
        "  }",
        "",
        '  @Queue("decorated.audit")',
        "  static async audit(ctx, todo) {",
        '    await ctx.query("INSERT INTO decorated_audit (todo_id, title) VALUES (?1, ?2)", [todo.id, todo.title]);',
        "  }",
        "",
        '  @Action("listDecoratedAudit")',
        "  static async listAudit(ctx) {",
        '    return await ctx.query("SELECT todo_id, title FROM decorated_audit ORDER BY id ASC");',
        "  }",
        "}",
        "",
        "registerDecoratedEntries({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerListener(name, handler) { return globalThis.defineListener(name, handler); },',
        '  registerQueue(name, handler, definition) { return globalThis.defineQueue(name, handler, definition); },',
        "}, DecoratedTodoModule);",
      ].join("\n"),
      "migrations/001_init.sql": [
        "CREATE TABLE IF NOT EXISTS decorated_todos (",
        "  id INTEGER PRIMARY KEY,",
        "  title TEXT NOT NULL",
        ");",
        "",
        "CREATE TABLE IF NOT EXISTS decorated_audit (",
        "  id INTEGER PRIMARY KEY,",
        "  todo_id INTEGER NOT NULL,",
        "  title TEXT NOT NULL",
        ");",
      ].join("\n"),
    }, [
      "[project]",
      'name = "decorator-test"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/test.db"',
      "",
    ]);

    const host = await ChimpbaseBunHost.load(projectDir);
    const created = await host.executeAction("createDecoratedTodo", ["Decorated runtime"]);

    expect(created.emittedEvents).toEqual([
      expect.objectContaining({
        name: "decorated.created",
      }),
    ]);

    const queueResult = await host.processNextQueueJob();
    expect(queueResult?.queueName).toBe("decorated.audit");

    const audit = await host.executeAction("listDecoratedAudit");
    expect(audit.result).toEqual([
      {
        title: "Decorated runtime",
        todo_id: 1,
      },
    ]);

    host.close();
  });

  test("registers instance methods with decorators", async () => {
    const projectDir = await createInlineFixture("decorator-instances", {
      "index.ts": [
        'import { Action, Listener, Queue, registerDecoratedEntries } from "@chimpbase/runtime";',
        "",
        "class InstanceDecoratedTodoModule {",
        '  @Action("createInstanceDecoratedTodo")',
        "  async create(ctx, title) {",
        '    await ctx.query("INSERT INTO instance_decorated_todos (title) VALUES (?1)", [title]);',
        '    const [todo] = await ctx.query("SELECT id, title FROM instance_decorated_todos WHERE id = last_insert_rowid() LIMIT 1");',
        '    ctx.emit("instance.decorated.created", todo);',
        "    return todo;",
        "  }",
        "",
        '  @Listener("instance.decorated.created")',
        "  async onCreated(ctx, todo) {",
        '    await ctx.queue.send("instance.decorated.audit", todo);',
        "  }",
        "",
        '  @Queue("instance.decorated.audit")',
        "  async audit(ctx, todo) {",
        '    await ctx.query("INSERT INTO instance_decorated_audit (todo_id, title) VALUES (?1, ?2)", [todo.id, todo.title]);',
        "  }",
        "",
        '  @Action("listInstanceDecoratedAudit")',
        "  async listAudit(ctx) {",
        '    return await ctx.query("SELECT todo_id, title FROM instance_decorated_audit ORDER BY id ASC");',
        "  }",
        "}",
        "",
        "const moduleInstance = new InstanceDecoratedTodoModule();",
        "registerDecoratedEntries({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerListener(name, handler) { return globalThis.defineListener(name, handler); },',
        '  registerQueue(name, handler, definition) { return globalThis.defineQueue(name, handler, definition); },',
        "}, moduleInstance);",
      ].join("\n"),
      "migrations/001_init.sql": [
        "CREATE TABLE IF NOT EXISTS instance_decorated_todos (",
        "  id INTEGER PRIMARY KEY,",
        "  title TEXT NOT NULL",
        ");",
        "",
        "CREATE TABLE IF NOT EXISTS instance_decorated_audit (",
        "  id INTEGER PRIMARY KEY,",
        "  todo_id INTEGER NOT NULL,",
        "  title TEXT NOT NULL",
        ");",
      ].join("\n"),
    }, [
      "[project]",
      'name = "decorator-instance-test"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/test.db"',
      "",
    ]);

    const host = await ChimpbaseBunHost.load(projectDir);
    const created = await host.executeAction("createInstanceDecoratedTodo", ["Instance decorated runtime"]);

    expect(created.emittedEvents).toEqual([
      expect.objectContaining({
        name: "instance.decorated.created",
      }),
    ]);

    const queueResult = await host.processNextQueueJob();
    expect(queueResult?.queueName).toBe("instance.decorated.audit");

    const audit = await host.executeAction("listInstanceDecoratedAudit");
    expect(audit.result).toEqual([
      {
        title: "Instance decorated runtime",
        todo_id: 1,
      },
    ]);

    host.close();
  });

  test("supports kv, collection and stream primitives", async () => {
    const projectDir = await createFixture("platform-primitives");
    const host = await ChimpbaseBunHost.load(projectDir);

    await host.executeAction("seedDemoWorkspace");
    const preference = await host.executeAction("setWorkspacePreference", [
      "timezone",
      { label: "America/Sao_Paulo" },
    ]);
    expect(preference.result).toEqual({
      key: "workspace.timezone",
      value: { label: "America/Sao_Paulo" },
    });

    const createdTodo = await host.executeAction("createTodo", [
      {
        assigneeEmail: "notes@chimpbase.dev",
        description: "Validate non-query primitives.",
        dueDate: "2026-04-01",
        priority: "medium",
        projectSlug: "operations-platform",
        title: "Primitive coverage todo",
      },
    ]);
    const todoId = (createdTodo.result as { id: number }).id;

    const note = await host.executeAction("addTodoNote", [
      {
        body: "Remember to validate collection storage.",
        todoId,
      },
    ]);
    expect((note.result as { id: string }).id).toBeString();

    const notes = await host.executeAction("listTodoNotes", [todoId]);
    expect(notes.result).toEqual([
      expect.objectContaining({
        body: "Remember to validate collection storage.",
        todoId,
      }),
    ]);

    await host.executeAction("startTodo", [todoId]);
    await host.executeAction("completeTodo", [todoId]);
    await host.processNextQueueJob();

    const preferences = await host.executeAction("listWorkspacePreferences");
    expect(preferences.result).toEqual([
      {
        key: "workspace.timezone",
        value: { label: "America/Sao_Paulo" },
      },
    ]);

    const activity = await host.executeAction("listTodoActivityStream", []);
    expect((activity.result as Array<{ event: string }>).some((entry) => entry.event === "todo.completed")).toBe(true);

    host.close();
  });
});

async function createFixture(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-bun-${label}-`));
  cleanupDirs.push(dir);

  await cp(resolve(exampleDir, "src"), resolve(dir, "src"), { recursive: true });
  await cp(resolve(exampleDir, "migrations"), resolve(dir, "migrations"), { recursive: true });
  await writeFile(
    resolve(dir, "index.ts"),
    [
      'import { todoApiApp } from "./src/http/app.ts";',
      'export const fetch = todoApiApp.fetch.bind(todoApiApp);',
      'export { todoApiApp as app };',
      'import { action, listener, queue, registerChimpbaseEntries } from "@chimpbase/runtime";',
      'import { createProject, listProjects } from "./src/modules/projects/project.actions.ts";',
      'import { assignTodo, completeTodo, createTodo, getTodoDashboard, listTodos, startTodo } from "./src/modules/todos/todo.actions.ts";',
      'import { listTodoAuditLog, listTodoEvents, listTodoNotifications } from "./src/modules/todos/todo.audit.actions.ts";',
      'import { auditTodoAssigned, auditTodoCompleted, auditTodoCreated, auditTodoStarted, enqueueTodoCompletedNotification } from "./src/modules/todos/todo.listeners.ts";',
      'import { addTodoNote, listTodoActivityStream, listTodoNotes, listWorkspacePreferences, setWorkspacePreference } from "./src/modules/todos/todo.platform.actions.ts";',
      'import { captureTodoCompletedDlq, notifyTodoCompleted } from "./src/modules/todos/todo.queues.ts";',
      'import { seedDemoWorkspace } from "./src/modules/todos/todo.seed.actions.ts";',
      'registerChimpbaseEntries({',
      '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
      '  registerListener(name, handler) { return globalThis.defineListener(name, handler); },',
      '  registerQueue(name, handler, definition) { return globalThis.defineQueue(name, handler, definition); },',
      '}, [',
      '  action("listProjects", listProjects),',
      '  action("createProject", createProject),',
      '  action("listTodos", listTodos),',
      '  action("createTodo", createTodo),',
      '  action("assignTodo", assignTodo),',
      '  action("startTodo", startTodo),',
      '  action("completeTodo", completeTodo),',
      '  action("getTodoDashboard", getTodoDashboard),',
      '  action("listTodoAuditLog", listTodoAuditLog),',
      '  action("listTodoEvents", listTodoEvents),',
      '  action("listTodoNotifications", listTodoNotifications),',
      '  listener("todo.created", auditTodoCreated),',
      '  listener("todo.assigned", auditTodoAssigned),',
      '  listener("todo.started", auditTodoStarted),',
      '  listener("todo.completed", auditTodoCompleted),',
      '  listener("todo.completed", enqueueTodoCompletedNotification),',
      '  action("listWorkspacePreferences", listWorkspacePreferences),',
      '  action("setWorkspacePreference", setWorkspacePreference),',
      '  action("addTodoNote", addTodoNote),',
      '  action("listTodoNotes", listTodoNotes),',
      '  action("listTodoActivityStream", listTodoActivityStream),',
      '  queue("todo.completed.notify", notifyTodoCompleted),',
      '  queue("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),',
      '  action("seedDemoWorkspace", seedDemoWorkspace),',
      ']);',
    ].join("\n"),
  );
  await writeFile(resolve(dir, "tsconfig.json"), await Bun.file(resolve(exampleDir, "tsconfig.json")).text());
  await mkdir(resolve(dir, "node_modules/@chimpbase"), { recursive: true });
  await cp(resolve(runtimeRoot, "packages/runtime"), resolve(dir, "node_modules/@chimpbase/runtime"), {
    recursive: true,
  });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          "@chimpbase/runtime": "file:./packages/runtime",
          hono: "^4.12.5",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(dir, "chimpbase.toml"),
    [
      "[project]",
      'name = "todo-ts-bun-test"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/test.db"',
      "",
      "[server]",
      "port = 39001",
      "",
    ].join("\n"),
  );

  await cp(resolve(exampleDir, "node_modules/hono"), resolve(dir, "node_modules/hono"), { recursive: true });

  return dir;
}

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function createInlineFixture(
  label: string,
  files: Record<string, string>,
  configLines: string[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-bun-inline-${label}-`));
  cleanupDirs.push(dir);

  await mkdir(resolve(dir, "node_modules/@chimpbase"), { recursive: true });
  await cp(resolve(runtimeRoot, "packages/runtime"), resolve(dir, "node_modules/@chimpbase/runtime"), {
    recursive: true,
  });

  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          "@chimpbase/runtime": "file:./packages/runtime",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts"],
      },
      null,
      2,
    ),
  );

  for (const [relativePath, contents] of Object.entries(files)) {
    const path = resolve(dir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, contents);
  }

  await mkdir(resolve(dir, "data"), { recursive: true });
  await writeFile(resolve(dir, "chimpbase.toml"), configLines.join("\n"));

  return dir;
}
