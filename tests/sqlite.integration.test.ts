import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { ChimpbaseBunHost } from "../packages/bun/src/runtime.ts";
import {
  createProjectFixture as createTodoTsDecoratorsFixture,
  startServer as startTodoTsDecoratorsServer,
} from "../examples/bun/todo-ts-decorators/tests/support/runtime-harness.ts";
import {
  createProjectFixture as createTodoTsNestjsDecoratorsFixture,
  startServer as startTodoTsNestjsDecoratorsServer,
} from "../examples/bun/todo-ts-nestjs-decorators/tests/support/runtime-harness.ts";
import {
  createProjectFixture as createTodoTsNestjsFixture,
  startServer as startTodoTsNestjsServer,
} from "../examples/bun/todo-ts-nestjs/tests/support/runtime-harness.ts";
import {
  createProjectFixture as createTodoTsFixture,
  startServer as startTodoTsServer,
  TEST_AUTH_HEADERS,
} from "../examples/bun/todo-ts/tests/support/runtime-harness.ts";
import { installLocalPackage } from "./support/local_package.ts";

const runtimeRoot = resolve(import.meta.dir, "..");
const exampleDir = resolve(runtimeRoot, "examples/bun/todo-ts");
const cleanupDirs: string[] = [];
const cleanupFixtures: Array<{ cleanup(): Promise<void> }> = [];

afterEach(async () => {
  while (cleanupFixtures.length > 0) {
    await cleanupFixtures.pop()?.cleanup();
  }

  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("sqlite integration", () => {
  test("executes ctx.db.kysely() via Kysely while keeping ctx.db.query() available", async () => {
    const projectDir = await createKyselyFixture("kysely");
    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      const created = await host.executeAction("createAccount", ["alice@sqlite.test", "Alice"]);
      expect(created.result).toEqual({
        email: "alice@sqlite.test",
        name: "Alice",
      });

      const accounts = await host.executeAction("listAccounts");
      expect(accounts.result).toEqual([
        expect.objectContaining({
          email: "alice@sqlite.test",
          name: "Alice",
        }),
      ]);

      await expect(
        host.executeAction("createAndFailAccount", ["broken@sqlite.test", "Broken"]),
      ).rejects.toThrow("boom");

      const afterFailure = await host.executeAction("listAccounts");
      expect(afterFailure.result).toEqual([
        expect.objectContaining({
          email: "alice@sqlite.test",
          name: "Alice",
        }),
      ]);
    } finally {
      host.close();
    }
  });

  test("executes actions, routes, queues and primitives via ChimpbaseBunHost.load", async () => {
    const projectDir = await createRuntimeFixture("runtime");
    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      await host.executeAction("seedDemoWorkspace");

      const dashboard = await host.executeAction("getTodoDashboard", {});
      expect(dashboard.result).toEqual(
        expect.objectContaining({
          backlog: expect.any(Number),
          total: expect.any(Number),
        }),
      );

      const createResponse = await host.executeRoute(
        new Request("http://todo.test/todos", {
          body: JSON.stringify({
            assigneeEmail: "sqlite-owner@chimpbase.dev",
            description: "Validate SQLite runtime integration.",
            dueDate: "2026-03-24",
            priority: "high",
            projectSlug: "operations-platform",
            title: "Run sqlite integration workflow",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      expect(createResponse.response?.status).toBe(201);

      const createdTodo = await createResponse.response?.json() as { id: number; title: string };
      expect(createdTodo.id).toBeNumber();

      await host.executeAction("startTodo", { todoId: createdTodo.id });
      await host.executeAction("completeTodo", { todoId: createdTodo.id });

      const queueResult = await host.processNextQueueJob();
      expect(queueResult?.queueName).toBe("todo.completed.notify");

      const notifications = await host.executeAction("listTodoNotifications");
      expect(notifications.result).toEqual([
        expect.objectContaining({
          queue_name: "todo.completed.notify",
          sender_email: "alerts@sqlite.test",
          todo_id: createdTodo.id,
        }),
      ]);

      const preference = await host.executeAction("setWorkspacePreference", {
        key: "timezone",
        value: { label: "UTC" },
      });
      expect(preference.result).toEqual({
        key: "workspace.timezone",
        value: { label: "UTC" },
      });

      const note = await host.executeAction("addTodoNote", [
        {
          body: "Persisted through SQLite collection storage.",
          todoId: createdTodo.id,
        },
      ]);
      expect((note.result as { id: string }).id).toBeString();

      const notes = await host.executeAction("listTodoNotes", { todoId: createdTodo.id });
      expect(notes.result).toEqual([
        expect.objectContaining({
          body: "Persisted through SQLite collection storage.",
          todoId: createdTodo.id,
        }),
      ]);

      const activity = await host.executeAction("listTodoActivityStream", {});
      expect((activity.result as Array<{ event: string }>).some((entry) => entry.event === "todo.completed")).toBe(true);
    } finally {
      host.close();
    }
  });

  test("boots the todo-ts example against SQLite", async () => {
    const fixture = await createTodoTsFixture("sqlite");
    cleanupFixtures.push(fixture);

    const server = await startTodoTsServer(
      fixture.projectDir,
      fixture.port,
      sqliteEnv(),
    );

    try {
      const seedResponse = await fetch(`${server.url}/seed`, { method: "POST", headers: TEST_AUTH_HEADERS });
      const projectsResponse = await fetch(`${server.url}/projects`, { headers: TEST_AUTH_HEADERS });
      const projects = await projectsResponse.json() as Array<{ slug: string }>;

      expect(seedResponse.status).toBe(201);
      expect(projects.some((project) => project.slug === "operations-platform")).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("boots the todo-ts-decorators example against SQLite", async () => {
    const fixture = await createTodoTsDecoratorsFixture("sqlite");
    cleanupFixtures.push(fixture);

    const server = await startTodoTsDecoratorsServer(
      fixture.projectDir,
      fixture.port,
      sqliteEnv(),
    );

    try {
      const seedResponse = await fetch(`${server.url}/seed`, { method: "POST" });
      const projectsResponse = await fetch(`${server.url}/projects`);
      const projects = await projectsResponse.json() as Array<{ slug: string }>;

      expect(seedResponse.status).toBe(201);
      expect(projects.some((project) => project.slug === "operations-platform")).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("boots the todo-ts-nestjs example against SQLite", async () => {
    const fixture = await createTodoTsNestjsFixture("sqlite");
    cleanupFixtures.push(fixture);

    const server = await startTodoTsNestjsServer(
      fixture.projectDir,
      fixture.port,
      sqliteEnv(),
    );

    try {
      const seedResponse = await fetch(`${server.url}/seed`, { method: "POST" });
      const projectsResponse = await fetch(`${server.url}/projects`);
      const projects = await projectsResponse.json() as Array<{ slug: string }>;

      expect(seedResponse.status).toBe(201);
      expect(projects.some((project) => project.slug === "operations-platform")).toBe(true);
    } finally {
      await server.stop();
    }
  }, 30000);

  test("boots the todo-ts-nestjs-decorators example against SQLite", async () => {
    const fixture = await createTodoTsNestjsDecoratorsFixture("sqlite");
    cleanupFixtures.push(fixture);

    const server = await startTodoTsNestjsDecoratorsServer(
      fixture.projectDir,
      fixture.port,
      sqliteEnv(),
    );

    try {
      const seedResponse = await fetch(`${server.url}/seed`, { method: "POST" });
      const projectsResponse = await fetch(`${server.url}/projects`);
      const projects = await projectsResponse.json() as Array<{ slug: string }>;

      expect(seedResponse.status).toBe(201);
      expect(projects.some((project) => project.slug === "operations-platform")).toBe(true);
    } finally {
      await server.stop();
    }
  }, 30000);
});

function sqliteEnv(): Record<string, string> {
  return {
    CHIMPBASE_STORAGE_ENGINE: "sqlite",
    CHIMPBASE_STORAGE_PATH: ":memory:",
    TODO_NOTIFIER_SENDER: "alerts@sqlite.test",
  };
}

async function createRuntimeFixture(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-sqlite-runtime-${label}-`));
  cleanupDirs.push(dir);

  await cp(resolve(exampleDir, "src"), resolve(dir, "src"), { recursive: true });
  await cp(resolve(exampleDir, "migrations"), resolve(dir, "migrations"), { recursive: true });
  await cp(resolve(exampleDir, "chimpbase.migrations.ts"), resolve(dir, "chimpbase.migrations.ts"));
  await writeFile(
    resolve(dir, "chimpbase.app.ts"),
    [
      'import { todoApiApp } from "./src/http/app.ts";',
      'import migrations from "./chimpbase.migrations.ts";',
      'import { action, worker, subscription } from "@chimpbase/runtime";',
      'import { createProject, listProjects } from "./src/modules/projects/project.actions.ts";',
      'import { assignTodo, completeTodo, createTodo, getTodoDashboard, listTodos, startTodo } from "./src/modules/todos/todo.actions.ts";',
      'import { listTodoAuditLog, listTodoEvents, listTodoNotifications } from "./src/modules/todos/todo.audit.actions.ts";',
      'import { auditTodoAssigned, auditTodoCompleted, auditTodoCreated, auditTodoStarted, enqueueTodoCompletedNotification } from "./src/modules/todos/todo.subscriptions.ts";',
      'import { addTodoNote, listTodoActivityStream, listTodoNotes, listWorkspacePreferences, setWorkspacePreference } from "./src/modules/todos/todo.platform.actions.ts";',
      'import { captureTodoCompletedDlq, notifyTodoCompleted } from "./src/modules/todos/todo.workers.ts";',
      'import { seedDemoWorkspace } from "./src/modules/todos/todo.seed.actions.ts";',
      '',
      'export default {',
      '  httpHandler: todoApiApp,',
      '  migrations,',
      '  project: { name: "todo-ts-sqlite-test" },',
      '  registrations: [',
      '    action("listProjects", listProjects),',
      '    action("createProject", createProject),',
      '    action("listTodos", listTodos),',
      '    action("createTodo", createTodo),',
      '    action("assignTodo", assignTodo),',
      '    action("startTodo", startTodo),',
      '    action("completeTodo", completeTodo),',
      '    action("getTodoDashboard", getTodoDashboard),',
      '    action("listTodoAuditLog", listTodoAuditLog),',
      '    action("listTodoEvents", listTodoEvents),',
      '    action("listTodoNotifications", listTodoNotifications),',
      '    subscription("todo.created", auditTodoCreated),',
      '    subscription("todo.assigned", auditTodoAssigned),',
      '    subscription("todo.started", auditTodoStarted),',
      '    subscription("todo.completed", auditTodoCompleted),',
      '    subscription("todo.completed", enqueueTodoCompletedNotification),',
      '    action("listWorkspacePreferences", listWorkspacePreferences),',
      '    action("setWorkspacePreference", setWorkspacePreference),',
      '    action("addTodoNote", addTodoNote),',
      '    action("listTodoNotes", listTodoNotes),',
      '    action("listTodoActivityStream", listTodoActivityStream),',
      '    worker("todo.completed.notify", notifyTodoCompleted),',
      '    worker("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),',
      '    action("seedDemoWorkspace", seedDemoWorkspace),',
      '  ],',
      '};',
    ].join("\n"),
  );
  await writeFile(resolve(dir, "tsconfig.json"), await Bun.file(resolve(exampleDir, "tsconfig.json")).text());
  await installLocalPackage(dir, "@chimpbase/core", resolve(runtimeRoot, "packages/core"));
  await installLocalPackage(dir, "@chimpbase/runtime", resolve(runtimeRoot, "packages/runtime"));
  await cp(resolve(runtimeRoot, "node_modules/kysely"), resolve(dir, "node_modules/kysely"), {
    recursive: true,
  });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          "@chimpbase/core": "file:./packages/core",
          "@chimpbase/runtime": "file:./packages/runtime",
          hono: "^4.12.5",
          kysely: "^0.28.11",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(dir, ".env"), "TODO_NOTIFIER_SENDER=alerts@sqlite.test\n");

  await cp(resolve(exampleDir, "node_modules/hono"), resolve(dir, "node_modules/hono"), { recursive: true });

  return dir;
}

async function createKyselyFixture(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-sqlite-kysely-${label}-`));
  cleanupDirs.push(dir);

  await installLocalPackage(dir, "@chimpbase/runtime", resolve(runtimeRoot, "packages/runtime"));
  await cp(resolve(runtimeRoot, "node_modules/kysely"), resolve(dir, "node_modules/kysely"), {
    recursive: true,
  });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          "@chimpbase/runtime": "file:./packages/runtime",
          kysely: "^0.28.11",
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
        include: ["**/*.ts"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(dir, "chimpbase.app.ts"),
    [
      'import type { Generated } from "kysely";',
      'import { action } from "@chimpbase/runtime";',
      "",
      "interface AccountTable {",
      "  id: Generated<number>;",
      "  email: string;",
      "  name: string;",
      "  created_at: Generated<string>;",
      "}",
      "",
      "interface Database {",
      "  accounts: AccountTable;",
      "}",
      "",
      "export default {",
      "  migrations: {",
      '    sqlite: [{ name: "001_init", sql: "CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);" }],',
      "  },",
      '  project: { name: "sqlite-kysely-test" },',
      "  registrations: [",
      '    action("createAccount", async (ctx, email, name) => {',
      "      const db = ctx.db.kysely<Database>();",
      '      await db.insertInto("accounts").values({ email, name }).execute();',
      '      const [row] = await ctx.db.query<{ email: string; name: string }>(',
      '        "SELECT email, name FROM accounts WHERE email = ?1",',
      "        [email],",
      "      );",
      "      return row;",
      "    }),",
      '    action("listAccounts", async (ctx) => {',
      "      const db = ctx.db.kysely<Database>();",
      '      return await db.selectFrom("accounts").select(["id", "email", "name"]).orderBy("id", "asc").execute();',
      "    }),",
      '    action("createAndFailAccount", async (ctx, email, name) => {',
      "      const db = ctx.db.kysely<Database>();",
      '      await db.insertInto("accounts").values({ email, name }).execute();',
      '      throw new Error("boom");',
      "    }),",
      "  ],",
      "};",
    ].join("\n"),
  );

  return dir;
}
