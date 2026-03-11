import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createChimpbase } from "../packages/bun/src/library.ts";
import { ChimpbaseBunHost } from "../packages/bun/src/runtime.ts";

const runtimeRoot = resolve(import.meta.dir, "..");
const exampleDir = resolve(runtimeRoot, "examples/bun/todo-ts");
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

  test("preloads secrets from mounted files before env vars and .env", async () => {
    const previousToken = process.env.APP_TOKEN;
    const projectDir = await createInlineFixture("secrets-mounted", {
      "index.ts": [
        'import { action, register } from "@chimpbase/runtime";',
        "",
        "register({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
        "}, [",
        '  action("readSecret", async (ctx, name) => ctx.secret(name)),',
        "]);",
      ].join("\n"),
    }, [
      "[project]",
      'name = "secrets-mounted"',
      "",
      "[storage]",
      'engine = "memory"',
      "",
      "[secrets]",
      'dir = "run/secrets"',
      "",
    ]);

    try {
      await writeFile(resolve(projectDir, ".env"), "APP_TOKEN=dotenv-token\n");
      await mkdir(resolve(projectDir, "run/secrets"), { recursive: true });
      await writeFile(resolve(projectDir, "run/secrets/APP_TOKEN"), "mounted-token");
      process.env.APP_TOKEN = "env-token";

      const host = await ChimpbaseBunHost.load(projectDir);

      try {
        const secret = await host.executeAction("readSecret", ["APP_TOKEN"]);
        expect(secret.result).toBe("mounted-token");
      } finally {
        host.close();
      }
    } finally {
      if (previousToken === undefined) {
        delete process.env.APP_TOKEN;
      } else {
        process.env.APP_TOKEN = previousToken;
      }
    }
  });

  test("falls back to .env secrets when mounted files and env vars are absent", async () => {
    const previousToken = process.env.APP_TOKEN;
    const projectDir = await createInlineFixture("secrets-dotenv", {
      "index.ts": [
        'import { action, register } from "@chimpbase/runtime";',
        "",
        "register({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
        "}, [",
        '  action("readSecret", async (ctx, name) => ctx.secret(name)),',
        "]);",
      ].join("\n"),
    }, [
      "[project]",
      'name = "secrets-dotenv"',
      "",
      "[storage]",
      'engine = "memory"',
      "",
    ]);

    try {
      delete process.env.APP_TOKEN;
      await writeFile(resolve(projectDir, ".env"), "APP_TOKEN=dotenv-token\n");

      const host = await ChimpbaseBunHost.load(projectDir);

      try {
        const beforeEnvMutation = await host.executeAction("readSecret", ["APP_TOKEN"]);
        expect(beforeEnvMutation.result).toBe("dotenv-token");

        process.env.APP_TOKEN = "late-env-token";
        const afterEnvMutation = await host.executeAction("readSecret", ["APP_TOKEN"]);
        expect(afterEnvMutation.result).toBe("dotenv-token");
      } finally {
        host.close();
      }
    } finally {
      if (previousToken === undefined) {
        delete process.env.APP_TOKEN;
      } else {
        process.env.APP_TOKEN = previousToken;
      }
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
          title: "Worker-backed completion notification",
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

  test("executes durable workflows across sleep and signal boundaries", async () => {
    const projectDir = await createInlineFixture("workflow-mvp", {
      "index.ts": [
        'import { action, register, workflow, workflowActionStep, workflowSleepStep, workflowWaitForSignalStep } from "@chimpbase/runtime";',
        "",
        "const onboardingWorkflow = workflow({",
        '    name: "customer.onboarding",',
        "    version: 1,",
        "    initialState(input) {",
        "      return {",
        "        activated: false,",
        "        customerId: input.customerId,",
        "        kickoffCompletedAt: null,",
        "        provisioned: false,",
        "      };",
        "    },",
        "    steps: [",
        '      workflowActionStep("provision-account", "provisionCustomer", {',
        "        args: ({ input }) => [input.customerId],",
        "        onResult: ({ state }) => ({ ...state, provisioned: true }),",
        "      }),",
        '      workflowSleepStep("wait-a-beat", 15),',
        '      workflowWaitForSignalStep("wait-kickoff", "kickoff.completed", {',
        "        onSignal: ({ payload, state }) => ({ ...state, kickoffCompletedAt: payload.completedAt }),",
        "        timeoutMs: 100,",
        '        onTimeout: "fail",',
        "      }),",
        '      workflowActionStep("activate-account", "activateCustomer", {',
        "        args: ({ state }) => [state.customerId],",
        "        onResult: ({ state }) => ({ ...state, activated: true }),",
        "      }),",
        "    ],",
        "});",
        "",
        "register({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
        '  registerWorkflow(definition) { return globalThis.defineWorkflow(definition); },',
        "}, [",
        "  onboardingWorkflow,",
        '  action("provisionCustomer", async (ctx, customerId) => {',
        '    await ctx.collection.insert("workflow_audit", { customerId, step: "provision" });',
        '    return { status: "ok" };',
        "  }),",
        '  action("activateCustomer", async (ctx, customerId) => {',
        '    await ctx.collection.insert("workflow_audit", { customerId, step: "activate" });',
        '    return { status: "ok" };',
        "  }),",
        '  action("startOnboarding", async (ctx, customerId) => {',
        '    return await ctx.workflow.start("customer.onboarding", { customerId }, { workflowId: `workflow:${customerId}` });',
        "  }),",
        '  action("signalKickoffCompleted", async (ctx, customerId, completedAt) => {',
        '    await ctx.workflow.signal(`workflow:${customerId}`, "kickoff.completed", { completedAt });',
        "    return { ok: true };",
        "  }),",
        '  action("getOnboarding", async (ctx, customerId) => await ctx.workflow.get(`workflow:${customerId}`)),',
        '  action("listWorkflowAudit", async (ctx) => await ctx.collection.find("workflow_audit")),',
        "]);",
      ].join("\n"),
    }, [
      "[project]",
      'name = "workflow-mvp"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/workflow.db"',
      "",
    ]);

    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      const started = await host.executeAction("startOnboarding", ["cus_123"]);
      expect(started.result).toEqual({
        status: "running",
        workflowId: "workflow:cus_123",
        workflowName: "customer.onboarding",
        workflowVersion: 1,
      });

      const firstRun = await host.processNextQueueJob();
      expect(firstRun?.queueName).toBe("__chimpbase.workflow.run");

      let instance = await host.executeAction("getOnboarding", ["cus_123"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: "wait-kickoff",
          state: expect.objectContaining({
            customerId: "cus_123",
            provisioned: true,
          }),
          status: "sleeping",
        }),
      );

      await Bun.sleep(20);
      const secondRun = await host.processNextQueueJob();
      expect(secondRun?.queueName).toBe("__chimpbase.workflow.run");

      instance = await host.executeAction("getOnboarding", ["cus_123"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: "wait-kickoff",
          status: "waiting_signal",
        }),
      );

      await host.executeAction("signalKickoffCompleted", ["cus_123", "2026-03-10T10:00:00.000Z"]);
      const thirdRun = await host.processNextQueueJob();
      expect(thirdRun?.queueName).toBe("__chimpbase.workflow.run");

      instance = await host.executeAction("getOnboarding", ["cus_123"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: null,
          state: {
            activated: true,
            customerId: "cus_123",
            kickoffCompletedAt: "2026-03-10T10:00:00.000Z",
            provisioned: true,
          },
          status: "completed",
        }),
      );

      const audit = await host.executeAction("listWorkflowAudit");
      expect(audit.result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ customerId: "cus_123", step: "provision" }),
          expect.objectContaining({ customerId: "cus_123", step: "activate" }),
        ]),
      );
    } finally {
      host.close();
    }
  });

  test("executes imperative durable workflows with switch-based state transitions", async () => {
    const projectDir = await createInlineFixture("workflow-imperative", {
      "index.ts": [
        'import { action, register, workflow } from "@chimpbase/runtime";',
        "",
        "const onboardingWorkflow = workflow({",
        '  name: "customer.onboarding.machine",',
        "  version: 1,",
        "  initialState(input) {",
        "    return {",
        '      phase: "provision",',
        "      activated: false,",
        "      customerId: input.customerId,",
        "      kickoffCompletedAt: null,",
        "      provisioned: false,",
        "    };",
        "  },",
        "  async run(wf) {",
        "    switch (wf.state.phase) {",
        '      case "provision": {',
        '        await wf.action("provisionCustomer", wf.state.customerId);',
        '        if (wf.state.customerId.startsWith("vip_")) {',
        "          return wf.sleep(15, {",
        '            stepId: "wait-a-beat",',
        '            state: { ...wf.state, phase: "waiting_kickoff", provisioned: true },',
        "          });",
        "        }",
        '        return wf.transition({ ...wf.state, phase: "waiting_kickoff", provisioned: true });',
        "      }",
        '      case "waiting_kickoff":',
        '        return wf.waitForSignal("kickoff.completed", {',
        '          stepId: "wait-kickoff",',
        '          timeoutMs: 100,',
        '          onSignal: ({ payload, state }) => ({ ...state, phase: "activating", kickoffCompletedAt: payload.completedAt }),',
        '          onTimeout: "fail",',
        "        });",
        '      case "activating":',
        '        await wf.action("activateCustomer", wf.state.customerId);',
        '        return wf.complete({ ...wf.state, phase: "done", activated: true });',
        '      case "done":',
        "        return wf.complete(wf.state);",
        "      default:",
        '        return wf.fail(`unknown phase: ${wf.state.phase}`);',
        "    }",
        "  },",
        "});",
        "",
        "register({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
        '  registerWorkflow(definition) { return globalThis.defineWorkflow(definition); },',
        "}, [",
        "  onboardingWorkflow,",
        '  action("provisionCustomer", async (ctx, customerId) => {',
        '    await ctx.collection.insert("workflow_machine_audit", { customerId, step: "provision" });',
        '    return { status: "ok" };',
        "  }),",
        '  action("activateCustomer", async (ctx, customerId) => {',
        '    await ctx.collection.insert("workflow_machine_audit", { customerId, step: "activate" });',
        '    return { status: "ok" };',
        "  }),",
        '  action("startOnboardingMachine", async (ctx, customerId) => {',
        '    return await ctx.workflow.start("customer.onboarding.machine", { customerId }, { workflowId: `workflow-machine:${customerId}` });',
        "  }),",
        '  action("signalMachineKickoffCompleted", async (ctx, customerId, completedAt) => {',
        '    await ctx.workflow.signal(`workflow-machine:${customerId}`, "kickoff.completed", { completedAt });',
        "    return { ok: true };",
        "  }),",
        '  action("getOnboardingMachine", async (ctx, customerId) => await ctx.workflow.get(`workflow-machine:${customerId}`)),',
        '  action("listWorkflowMachineAudit", async (ctx) => await ctx.collection.find("workflow_machine_audit")),',
        "]);",
      ].join("\n"),
    }, [
      "[project]",
      'name = "workflow-imperative"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/workflow-imperative.db"',
      "",
    ]);

    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      const started = await host.executeAction("startOnboardingMachine", ["vip_123"]);
      expect(started.result).toEqual({
        status: "running",
        workflowId: "workflow-machine:vip_123",
        workflowName: "customer.onboarding.machine",
        workflowVersion: 1,
      });

      const firstRun = await host.processNextQueueJob();
      expect(firstRun?.queueName).toBe("__chimpbase.workflow.run");

      let instance = await host.executeAction("getOnboardingMachine", ["vip_123"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: "wait-a-beat",
          state: expect.objectContaining({
            customerId: "vip_123",
            phase: "waiting_kickoff",
            provisioned: true,
          }),
          status: "sleeping",
        }),
      );

      await Bun.sleep(20);
      const secondRun = await host.processNextQueueJob();
      expect(secondRun?.queueName).toBe("__chimpbase.workflow.run");

      instance = await host.executeAction("getOnboardingMachine", ["vip_123"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: "wait-kickoff",
          status: "waiting_signal",
        }),
      );

      await host.executeAction("signalMachineKickoffCompleted", ["vip_123", "2026-03-11T11:00:00.000Z"]);
      const thirdRun = await host.processNextQueueJob();
      expect(thirdRun?.queueName).toBe("__chimpbase.workflow.run");

      instance = await host.executeAction("getOnboardingMachine", ["vip_123"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: null,
          state: {
            activated: true,
            customerId: "vip_123",
            kickoffCompletedAt: "2026-03-11T11:00:00.000Z",
            phase: "done",
            provisioned: true,
          },
          status: "completed",
        }),
      );

      const audit = await host.executeAction("listWorkflowMachineAudit");
      expect(audit.result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ customerId: "vip_123", step: "provision" }),
          expect.objectContaining({ customerId: "vip_123", step: "activate" }),
        ]),
      );
    } finally {
      host.close();
    }
  });

  test("routes failed jobs to a custom dlq", async () => {
    const projectDir = await createInlineFixture("dlq", {
      "index.ts": [
        'import { action, worker, register } from "@chimpbase/runtime";',
        "",
        'const entries = [',
        'action("enqueueExplodingJob", async (ctx) => {',
        '  await ctx.queue.enqueue("todo.explodes", { todoId: 7 });',
        "  return null;",
        "}),",
        "",
        'worker("todo.explodes", async () => {',
        '  throw new Error("boom");',
        "}, {",
        '  dlq: "todo.explodes.failed"',
        "}),",
        "",
        'worker("todo.explodes.failed", async (ctx, envelope) => {',
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
        'register({',
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
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

  test("registers actions, subscriptions and workers with decorators", async () => {
    const projectDir = await createInlineFixture("decorators", {
      "index.ts": [
        'import { Action, Worker, Subscription, registerFrom } from "@chimpbase/runtime";',
        "",
        "class DecoratedTodoModule {",
        '  @Action("createDecoratedTodo")',
        "  static async create(ctx, title) {",
        '    await ctx.query("INSERT INTO decorated_todos (title) VALUES (?1)", [title]);',
        '    const [todo] = await ctx.query("SELECT id, title FROM decorated_todos WHERE id = last_insert_rowid() LIMIT 1");',
        '    ctx.pubsub.publish("decorated.created", todo);',
        "    return todo;",
        "  }",
        "",
        '  @Subscription("decorated.created")',
        "  static async onCreated(ctx, todo) {",
        '    await ctx.queue.enqueue("decorated.audit", todo);',
        "  }",
        "",
        '  @Worker("decorated.audit")',
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
        "registerFrom({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
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
        'import { Action, Worker, Subscription, registerFrom } from "@chimpbase/runtime";',
        "",
        "class InstanceDecoratedTodoModule {",
        '  @Action("createInstanceDecoratedTodo")',
        "  async create(ctx, title) {",
        '    await ctx.query("INSERT INTO instance_decorated_todos (title) VALUES (?1)", [title]);',
        '    const [todo] = await ctx.query("SELECT id, title FROM instance_decorated_todos WHERE id = last_insert_rowid() LIMIT 1");',
        '    ctx.pubsub.publish("instance.decorated.created", todo);',
        "    return todo;",
        "  }",
        "",
        '  @Subscription("instance.decorated.created")',
        "  async onCreated(ctx, todo) {",
        '    await ctx.queue.enqueue("instance.decorated.audit", todo);',
        "  }",
        "",
        '  @Worker("instance.decorated.audit")',
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
        "registerFrom({",
        '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
        '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
        '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
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
      'import { action, worker, register, subscription } from "@chimpbase/runtime";',
      'import { createProject, listProjects } from "./src/modules/projects/project.actions.ts";',
      'import { assignTodo, completeTodo, createTodo, getTodoDashboard, listTodos, startTodo } from "./src/modules/todos/todo.actions.ts";',
      'import { listTodoAuditLog, listTodoEvents, listTodoNotifications } from "./src/modules/todos/todo.audit.actions.ts";',
        'import { auditTodoAssigned, auditTodoCompleted, auditTodoCreated, auditTodoStarted, enqueueTodoCompletedNotification } from "./src/modules/todos/todo.subscriptions.ts";',
      'import { addTodoNote, listTodoActivityStream, listTodoNotes, listWorkspacePreferences, setWorkspacePreference } from "./src/modules/todos/todo.platform.actions.ts";',
      'import { captureTodoCompletedDlq, notifyTodoCompleted } from "./src/modules/todos/todo.workers.ts";',
      'import { seedDemoWorkspace } from "./src/modules/todos/todo.seed.actions.ts";',
      'register({',
      '  registerAction(name, handler) { return globalThis.defineAction(name, handler); },',
      '  registerSubscription(name, handler) { return globalThis.defineSubscription(name, handler); },',
      '  registerWorker(name, handler, definition) { return globalThis.defineWorker(name, handler, definition); },',
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
      '  subscription("todo.created", auditTodoCreated),',
      '  subscription("todo.assigned", auditTodoAssigned),',
      '  subscription("todo.started", auditTodoStarted),',
      '  subscription("todo.completed", auditTodoCompleted),',
      '  subscription("todo.completed", enqueueTodoCompletedNotification),',
      '  action("listWorkspacePreferences", listWorkspacePreferences),',
      '  action("setWorkspacePreference", setWorkspacePreference),',
      '  action("addTodoNote", addTodoNote),',
      '  action("listTodoNotes", listTodoNotes),',
      '  action("listTodoActivityStream", listTodoActivityStream),',
      '  worker("todo.completed.notify", notifyTodoCompleted),',
      '  worker("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),',
      '  action("seedDemoWorkspace", seedDemoWorkspace),',
      ']);',
    ].join("\n"),
  );
  await writeFile(resolve(dir, "tsconfig.json"), await Bun.file(resolve(exampleDir, "tsconfig.json")).text());
  await mkdir(resolve(dir, "node_modules/@chimpbase"), { recursive: true });
  await cp(resolve(runtimeRoot, "packages/runtime"), resolve(dir, "node_modules/@chimpbase/runtime"), {
    recursive: true,
  });
  await cp(resolve(runtimeRoot, "node_modules/kysely"), resolve(dir, "node_modules/kysely"), {
    recursive: true,
  });
  await writeFile(
    resolve(dir, "package.json"),
    JSON.stringify(
      {
        dependencies: {
          "@chimpbase/runtime": "file:./packages/runtime",
          hono: "^4.12.5",
          kysely: "^0.28.11",
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
