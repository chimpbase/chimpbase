import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createChimpbase } from "../packages/bun/src/library.ts";
import {
  createProjectFixture as createTodoTsDecoratorsFixture,
  runAction as runTodoTsDecoratorsAction,
} from "../examples/bun/todo-ts-decorators/tests/support/runtime-harness.ts";
import {
  createProjectFixture as createTodoTsNestjsDecoratorsFixture,
  runAction as runTodoTsNestjsDecoratorsAction,
} from "../examples/bun/todo-ts-nestjs-decorators/tests/support/runtime-harness.ts";
import {
  createProjectFixture as createTodoTsNestjsFixture,
  runAction as runTodoTsNestjsAction,
} from "../examples/bun/todo-ts-nestjs/tests/support/runtime-harness.ts";
import {
  createProjectFixture as createTodoTsFixture,
  runAction as runTodoTsAction,
} from "../examples/bun/todo-ts/tests/support/runtime-harness.ts";
import {
  canUseDocker,
  startPostgresDocker,
  type PostgresDockerHandle,
} from "../packages/bun/src/postgres_docker.ts";
import { installLocalPackage } from "./support/local_package.ts";

const runtimeRoot = resolve(import.meta.dir, "..");
const exampleDir = resolve(runtimeRoot, "examples/bun/todo-ts");
const dockerAvailable = await canUseDocker();
const cleanupDirs: string[] = [];
const cleanupFixtures: Array<{ cleanup(): Promise<void> }> = [];

if (!dockerAvailable) {
  test.skip("postgres integration requires Docker", () => {});
} else {
  describe("postgres integration", () => {
    let postgres: PostgresDockerHandle;

    beforeAll(async () => {
      postgres = await startPostgresDocker();
    }, 30000);

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

    afterAll(async () => {
      await postgres?.stop();
    }, 30000);

    test("executes actions, routes, queues and primitives via ChimpbaseBunHost.load", async () => {
      const database = await postgres.createDatabase("runtime");
      const projectDir = await createRuntimeFixture("runtime", database.url);
      const host = await createChimpbase.from(projectDir, {
        storage: { engine: "postgres", url: database.url },
      });

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
              assigneeEmail: "postgres-owner@chimpbase.dev",
              description: "Validate Postgres runtime integration.",
              dueDate: "2026-03-24",
              priority: "high",
              projectSlug: "operations-platform",
              title: "Run postgres integration workflow",
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
            sender_email: "alerts@postgres.test",
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
            body: "Persisted through Postgres collection storage.",
            todoId: createdTodo.id,
          },
        ]);
        expect((note.result as { id: string }).id).toBeString();

        const notes = await host.executeAction("listTodoNotes", { todoId: createdTodo.id });
        expect(notes.result).toEqual([
          expect.objectContaining({
            body: "Persisted through Postgres collection storage.",
            todoId: createdTodo.id,
          }),
        ]);

        const activity = await host.executeAction("listTodoActivityStream", {});
        expect((activity.result as Array<{ event: string }>).some((entry) => entry.event === "todo.completed")).toBe(true);
      } finally {
        host.close();
      }
    }, 30000);

    test("runs postgres worker lanes concurrently when configured", async () => {
      const database = await postgres.createDatabase("worker_concurrency");
      const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-postgres-worker-concurrency-"));
      cleanupDirs.push(projectDir);

      const host = await createChimpbase({
        project: { name: "postgres-worker-concurrency" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
        worker: { retryDelayMs: 0 },
        workerRuntime: {
          concurrency: 2,
          pollIntervalMs: 1,
        },
      });

      const started: string[] = [];
      const completed: string[] = [];
      let released = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = () => {
          if (!released) {
            released = true;
            resolve();
          }
        };
      });

      host.registerAction("enqueueSlowJobs", async (ctx) => {
        await ctx.queue.enqueue("slow.job", { value: "one" });
        await ctx.queue.enqueue("slow.job", { value: "two" });
        return null;
      });
      host.registerWorker("slow.job", async (_ctx, payload) => {
        const value = (payload as { value: string }).value;
        started.push(value);
        await gate;
        completed.push(value);
      });

      const runtime = host.start({ runWorker: true, serve: false });

      try {
        await host.executeAction("enqueueSlowJobs");

        const startedJobs = await waitFor(
          async () => [...started],
          (values) => values.length === 2,
          { intervalMs: 10, timeoutMs: 1_000 },
        );
        expect(startedJobs.sort()).toEqual(["one", "two"]);

        release();

        const completedJobs = await waitFor(
          async () => [...completed],
          (values) => values.length === 2,
          { intervalMs: 10, timeoutMs: 1_000 },
        );
        expect(completedJobs.sort()).toEqual(["one", "two"]);
      } finally {
        release();
        await runtime.stop();
        host.close();
      }
    }, 30000);

    test("claims only queue names registered on each Postgres host", async () => {
      const database = await postgres.createDatabase("named_queue_claim");
      const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-postgres-named-queue-claim-"));
      cleanupDirs.push(projectDir);

      const migrationsSql = [
        "CREATE TABLE IF NOT EXISTS customer_sync_audit (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL);",
      ];

      const publisher = await createChimpbase({
        migrationsSql,
        project: { name: "postgres-named-queue-publisher" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
      });
      const subscriber = await createChimpbase({
        migrationsSql,
        project: { name: "postgres-named-queue-subscriber" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
        subscriptions: {
          dispatch: "async",
        },
      });
      const workerHost = await createChimpbase({
        migrationsSql,
        project: { name: "postgres-named-queue-worker" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
      });

      publisher.registerAction("publishCustomerCreated", async (ctx, payload) => {
        ctx.pubsub.publish("customer.created", payload as { customerId: number });
        return null;
      });
      publisher.registerAction(
        "listQueueJobs",
        async (ctx) =>
          await ctx.db.query(
            "SELECT queue_name, attempt_count, status FROM _chimpbase_queue_jobs ORDER BY id ASC",
          ),
      );
      publisher.registerAction(
        "listCustomerSyncAudit",
        async (ctx) =>
          await ctx.db.query(
            "SELECT customer_id::double precision AS customer_id FROM customer_sync_audit ORDER BY id ASC",
          ),
      );

      subscriber.registerSubscription(
        "customer.created",
        async (ctx, payload) => {
          await ctx.queue.enqueue("customer.sync", payload);
        },
        { name: "enqueueCustomerSync" },
      );
      workerHost.registerWorker("customer.sync", async (ctx, payload) => {
        await ctx.db.query(
          "INSERT INTO customer_sync_audit (customer_id) VALUES (?1)",
          [(payload as { customerId: number }).customerId],
        );
      });

      const startedSubscriber = subscriber.start({ runWorker: true, serve: false });
      const startedWorker = workerHost.start({ runWorker: true, serve: false });

      try {
        await Bun.sleep(100);
        await publisher.executeAction("publishCustomerCreated", [{ customerId: 7 }]);

        const auditRows = await waitFor(async () => {
          const outcome = await publisher.executeAction("listCustomerSyncAudit");
          return outcome.result as Array<{ customer_id: number }>;
        }, (rows) => rows.length === 1);
        expect(auditRows).toEqual([{ customer_id: 7 }]);

        const queueJobs = await waitFor(async () => {
          const outcome = await publisher.executeAction("listQueueJobs");
          return outcome.result as Array<{ attempt_count: number; queue_name: string; status: string }>;
        }, (rows) => rows.some((row) => row.queue_name === "customer.sync" && row.status === "completed"));

        expect(queueJobs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            attempt_count: 1,
            queue_name: "__chimpbase.subscription.run",
            status: "completed",
          }),
          expect.objectContaining({
            attempt_count: 1,
            queue_name: "customer.sync",
            status: "completed",
          }),
        ]));
      } finally {
        await startedSubscriber.stop();
        await startedWorker.stop();
        publisher.close();
        subscriber.close();
        workerHost.close();
      }
    }, 30000);

    test("executes ctx.db.kysely() via Kysely while keeping ctx.db.query() available", async () => {
      const database = await postgres.createDatabase("kysely");
      const projectDir = await createKyselyFixture("kysely", database.url);
      const host = await createChimpbase.from(projectDir, {
        storage: { engine: "postgres", url: database.url },
      });

      try {
        const created = await host.executeAction("createAccount", ["alice@postgres.test", "Alice"]);
        expect(created.result).toEqual({
          email: "alice@postgres.test",
          name: "Alice",
        });

        const accounts = await host.executeAction("listAccounts");
        expect(accounts.result).toEqual([
          expect.objectContaining({
            email: "alice@postgres.test",
            name: "Alice",
          }),
        ]);

        await expect(
          host.executeAction("createAndFailAccount", ["broken@postgres.test", "Broken"]),
        ).rejects.toThrow("boom");

        const afterFailure = await host.executeAction("listAccounts");
        expect(afterFailure.result).toEqual([
          expect.objectContaining({
            email: "alice@postgres.test",
            name: "Alice",
          }),
        ]);
      } finally {
        host.close();
      }
    }, 30000);

    test("processes an idempotent subscription only once when the same Postgres event id is re-polled", async () => {
      const database = await postgres.createDatabase("idempotent_subscriptions");
      const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-postgres-idempotent-"));
      cleanupDirs.push(projectDir);

      const migrationsSql = [
        "CREATE TABLE IF NOT EXISTS idempotent_audit (id BIGSERIAL PRIMARY KEY, value TEXT NOT NULL);",
      ];
      const subscriber = await createChimpbase({
        migrationsSql,
        project: { name: "postgres-idempotent-subscriber" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
      });
      const publisher = await createChimpbase({
        migrationsSql,
        project: { name: "postgres-idempotent-publisher" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
      });

      subscriber.registerSubscription(
        "audit.created",
        async (ctx, payload) => {
          await ctx.db.query("INSERT INTO idempotent_audit (value) VALUES (?1)", [(payload as { value: string }).value]);
        },
        { idempotent: true, name: "onAuditCreated" },
      );
      publisher.registerAction("publishAudit", async (ctx, value) => {
        ctx.pubsub.publish("audit.created", { value });
        return null;
      });
      publisher.registerAction(
        "listAudit",
        async (ctx) => await ctx.db.query("SELECT value FROM idempotent_audit ORDER BY id ASC"),
      );
      publisher.registerAction(
        "listEvents",
        async (ctx) => await ctx.db.query("SELECT id::double precision AS id, event_name FROM _chimpbase_events ORDER BY id ASC"),
      );
      publisher.registerAction(
        "listSeenKeys",
        async (ctx) =>
          await ctx.db.query(
            "SELECT key FROM _chimpbase_kv WHERE key LIKE ?1 ORDER BY key ASC",
            ["_chimpbase.sub.seen:%"],
          ),
      );

      const startedSubscriber = subscriber.start({ runWorker: false, serve: false });

      try {
        await Bun.sleep(100);
        await publisher.executeAction("publishAudit", ["from-publisher"]);

        const audit = await waitFor(async () => {
          const outcome = await publisher.executeAction("listAudit");
          return outcome.result as Array<{ value: string }>;
        }, (rows) => rows.length === 1);
        expect(audit).toEqual([{ value: "from-publisher" }]);

        const events = await publisher.executeAction("listEvents");
        expect(events.result).toEqual([
          expect.objectContaining({ event_name: "audit.created", id: expect.any(Number) }),
        ]);
        const [event] = events.result as Array<{ event_name: string; id: number }>;

        const seenKeys = await publisher.executeAction("listSeenKeys");
        expect(seenKeys.result).toEqual([
          { key: `_chimpbase.sub.seen:${event.id}:onAuditCreated` },
        ]);

        const subscriberEventBus = (subscriber.engine as any).eventBus as { lastSeenId: number };
        subscriberEventBus.lastSeenId = 0;

        await Bun.sleep(1_200);

        const auditAfterReplay = await publisher.executeAction("listAudit");
        expect(auditAfterReplay.result).toEqual([{ value: "from-publisher" }]);

        const seenKeysAfterReplay = await publisher.executeAction("listSeenKeys");
        expect(seenKeysAfterReplay.result).toEqual([
          { key: `_chimpbase.sub.seen:${event.id}:onAuditCreated` },
        ]);
      } finally {
        await startedSubscriber.stop();
        publisher.close();
        subscriber.close();
      }
    }, 30000);

    test("prunes stale idempotent subscription markers through the internal retention cron", async () => {
      const realDateNow = Date.now;
      let now = Date.UTC(2026, 2, 12, 2, 59, 0);
      Date.now = () => now;

      const database = await postgres.createDatabase("idempotent_subscription_cleanup");
      const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-postgres-idempotent-cleanup-"));
      cleanupDirs.push(projectDir);

      const subscriber = await createChimpbase({
        project: { name: "postgres-idempotent-cleanup-subscriber" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
        subscriptions: {
          idempotency: {
            retention: {
              enabled: true,
              maxAgeDays: 7,
              schedule: "0 3 * * *",
            },
          },
        },
      });
      const publisher = await createChimpbase({
        project: { name: "postgres-idempotent-cleanup-publisher" },
        projectDir,
        storage: { engine: "postgres", url: database.url },
      });

      subscriber.registerSubscription(
        "audit.created",
        async () => {},
        { idempotent: true, name: "onAuditCreated" },
      );
      publisher.registerAction("publishAudit", async (ctx, value) => {
        ctx.pubsub.publish("audit.created", { value });
        return null;
      });
      publisher.registerAction(
        "listSeenKeys",
        async (ctx) => (await ctx.kv.list({ prefix: "_chimpbase.sub.seen:" })).map((key) => ({ key })),
      );
      publisher.registerAction("setSeenKey", async (ctx, key) => {
        await ctx.kv.set(key as string, true);
        return null;
      });
      publisher.registerAction("backdateSeenKey", async (ctx, key, updatedAt) => {
        await ctx.db.query("UPDATE _chimpbase_kv SET updated_at = ?1 WHERE key = ?2", [updatedAt, key]);
        return null;
      });

      const startedSubscriber = subscriber.start({ runWorker: false, serve: false });

      try {
        await Bun.sleep(100);
        await publisher.executeAction("publishAudit", ["from-publisher"]);

        const seenKeyRows = await waitFor(async () => {
          const outcome = await publisher.executeAction("listSeenKeys");
          return outcome.result as Array<{ key: string }>;
        }, (rows) => rows.length === 1);
        const staleMarkerKey = seenKeyRows[0]!.key;
        const freshMarkerKey = "_chimpbase.sub.seen:manual:fresh";

        await publisher.executeAction("setSeenKey", [freshMarkerKey]);
        await publisher.executeAction("backdateSeenKey", [staleMarkerKey, "2026-03-01T00:00:00.000Z"]);

        await subscriber.syncCronSchedules();

        now = Date.UTC(2026, 2, 12, 3, 0, 0);
        expect((await subscriber.processNextCronSchedule())?.scheduleName).toBe("__chimpbase.subscription.idempotency.cleanup");
        expect((await subscriber.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");

        const remainingKeys = await publisher.executeAction("listSeenKeys");
        expect(remainingKeys.result).toEqual([{ key: freshMarkerKey }]);
      } finally {
        await startedSubscriber.stop();
        publisher.close();
        subscriber.close();
        Date.now = realDateNow;
      }
    }, 30000);

    test("executes durable workflows via ChimpbaseBunHost.load on Postgres", async () => {
      const database = await postgres.createDatabase("workflow");
      const projectDir = await createWorkflowFixture("workflow", database.url);
      const host = await createChimpbase.from(projectDir, {
        storage: { engine: "postgres", url: database.url },
      });

      try {
        const started = await host.executeAction("startOnboarding", ["cus_pg"]);
        expect(started.result).toEqual({
          status: "running",
          workflowId: "workflow:cus_pg",
          workflowName: "customer.onboarding",
          workflowVersion: 1,
        });

        const firstRun = await host.processNextQueueJob();
        expect(firstRun?.queueName).toBe("__chimpbase.workflow.run");

        let instance = await host.executeAction("getOnboarding", ["cus_pg"]);
        expect(instance.result).toEqual(
          expect.objectContaining({
            currentStepId: "wait-kickoff",
            state: expect.objectContaining({
              customerId: "cus_pg",
              provisioned: true,
            }),
            status: "sleeping",
          }),
        );

        await Bun.sleep(20);
        const secondRun = await host.processNextQueueJob();
        expect(secondRun?.queueName).toBe("__chimpbase.workflow.run");

        await host.executeAction("signalKickoffCompleted", ["cus_pg", "2026-03-11T10:00:00.000Z"]);
        const thirdRun = await host.processNextQueueJob();
        expect(thirdRun?.queueName).toBe("__chimpbase.workflow.run");

        instance = await host.executeAction("getOnboarding", ["cus_pg"]);
        expect(instance.result).toEqual(
          expect.objectContaining({
            currentStepId: null,
            state: {
              activated: true,
              customerId: "cus_pg",
              kickoffCompletedAt: "2026-03-11T10:00:00.000Z",
              provisioned: true,
            },
            status: "completed",
          }),
        );
      } finally {
        host.close();
      }
    }, 30000);

    test("executes imperative durable workflows via ChimpbaseBunHost.load on Postgres", async () => {
      const database = await postgres.createDatabase("workflow_machine");
      const projectDir = await createImperativeWorkflowFixture("workflow-machine", database.url);
      const host = await createChimpbase.from(projectDir, {
        storage: { engine: "postgres", url: database.url },
      });

      try {
        const started = await host.executeAction("startOnboardingMachine", ["vip_pg"]);
        expect(started.result).toEqual({
          status: "running",
          workflowId: "workflow-machine:vip_pg",
          workflowName: "customer.onboarding.machine",
          workflowVersion: 1,
        });

        const firstRun = await host.processNextQueueJob();
        expect(firstRun?.queueName).toBe("__chimpbase.workflow.run");

        let instance = await host.executeAction("getOnboardingMachine", ["vip_pg"]);
        expect(instance.result).toEqual(
          expect.objectContaining({
            currentStepId: "wait-a-beat",
            state: expect.objectContaining({
              customerId: "vip_pg",
              phase: "waiting_kickoff",
              provisioned: true,
            }),
            status: "sleeping",
          }),
        );

        await Bun.sleep(20);
        const secondRun = await host.processNextQueueJob();
        expect(secondRun?.queueName).toBe("__chimpbase.workflow.run");

        await host.executeAction("signalMachineKickoffCompleted", ["vip_pg", "2026-03-11T12:00:00.000Z"]);
        const thirdRun = await host.processNextQueueJob();
        expect(thirdRun?.queueName).toBe("__chimpbase.workflow.run");

        instance = await host.executeAction("getOnboardingMachine", ["vip_pg"]);
        expect(instance.result).toEqual(
          expect.objectContaining({
            currentStepId: null,
            state: {
              activated: true,
              customerId: "vip_pg",
              kickoffCompletedAt: "2026-03-11T12:00:00.000Z",
              phase: "done",
              provisioned: true,
            },
            status: "completed",
          }),
        );
      } finally {
        host.close();
      }
    }, 30000);

    test("schedules durable cron runs on Postgres without stalling after handler failure", async () => {
      const realDateNow = Date.now;
      let now = Date.UTC(2026, 2, 11, 12, 1, 0);
      Date.now = () => now;

      const database = await postgres.createDatabase("cron");
      const projectDir = await createCronFixture("cron", database.url);
      const host = await createChimpbase.from(projectDir, {
        storage: { engine: "postgres", url: database.url },
      });

      try {
        await host.syncCronSchedules();

        const initialSchedules = await host.executeAction("listCronSchedules");
        expect(initialSchedules.result).toEqual([
          {
            cron_expression: "*/5 * * * *",
            next_fire_at_ms: Date.UTC(2026, 2, 11, 12, 5, 0),
            schedule_name: "billing.rollup",
          },
        ]);

        now = Date.UTC(2026, 2, 11, 12, 5, 0);
        expect((await host.processNextCronSchedule())?.nextFireAtMs).toBe(Date.UTC(2026, 2, 11, 12, 10, 0));
        expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");

        await host.executeAction("setCronFailure", [true]);

        now = Date.UTC(2026, 2, 11, 12, 10, 0);
        expect((await host.processNextCronSchedule())?.nextFireAtMs).toBe(Date.UTC(2026, 2, 11, 12, 15, 0));
        await expect(host.processNextQueueJob()).rejects.toThrow("boom");

        const schedulesAfterFailure = await host.executeAction("listCronSchedules");
        expect(schedulesAfterFailure.result).toEqual([
          {
            cron_expression: "*/5 * * * *",
            next_fire_at_ms: Date.UTC(2026, 2, 11, 12, 15, 0),
            schedule_name: "billing.rollup",
          },
        ]);

        now = Date.UTC(2026, 2, 11, 12, 15, 0);
        expect((await host.processNextCronSchedule())?.nextFireAtMs).toBe(Date.UTC(2026, 2, 11, 12, 20, 0));

        await host.executeAction("setCronFailure", [false]);

        expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");
        expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");

        const audit = await host.executeAction("listCronAudit");
        expect(audit.result).toEqual([
          {
            fire_at_ms: Date.UTC(2026, 2, 11, 12, 5, 0),
            schedule_name: "billing.rollup",
          },
          {
            fire_at_ms: Date.UTC(2026, 2, 11, 12, 10, 0),
            schedule_name: "billing.rollup",
          },
          {
            fire_at_ms: Date.UTC(2026, 2, 11, 12, 15, 0),
            schedule_name: "billing.rollup",
          },
        ]);
      } finally {
        Date.now = realDateNow;
        host.close();
      }
    }, 30000);

    test("skips missed cron fires on Postgres and resumes from the current slot", async () => {
      const realDateNow = Date.now;
      let now = Date.UTC(2026, 2, 11, 12, 1, 0);
      Date.now = () => now;

      const database = await postgres.createDatabase("cron_skip_missed");
      const projectDir = await createCronFixture("cron_skip_missed", database.url);
      const host = await createChimpbase.from(projectDir, {
        storage: { engine: "postgres", url: database.url },
      });

      try {
        await host.syncCronSchedules();

        const initialSchedules = await host.executeAction("listCronSchedules");
        expect(initialSchedules.result).toEqual([
          {
            cron_expression: "*/5 * * * *",
            next_fire_at_ms: Date.UTC(2026, 2, 11, 12, 5, 0),
            schedule_name: "billing.rollup",
          },
        ]);

        now = Date.UTC(2026, 2, 11, 12, 22, 0);
        expect(await host.processNextCronSchedule()).toEqual({
          fireAt: "2026-03-11T12:20:00.000Z",
          fireAtMs: Date.UTC(2026, 2, 11, 12, 20, 0),
          nextFireAt: "2026-03-11T12:25:00.000Z",
          nextFireAtMs: Date.UTC(2026, 2, 11, 12, 25, 0),
          scheduleName: "billing.rollup",
        });

        expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");
        expect(await host.processNextCronSchedule()).toBeNull();

        const audit = await host.executeAction("listCronAudit");
        expect(audit.result).toEqual([
          {
            fire_at_ms: Date.UTC(2026, 2, 11, 12, 20, 0),
            schedule_name: "billing.rollup",
          },
        ]);

        const schedulesAfterResume = await host.executeAction("listCronSchedules");
        expect(schedulesAfterResume.result).toEqual([
          {
            cron_expression: "*/5 * * * *",
            next_fire_at_ms: Date.UTC(2026, 2, 11, 12, 25, 0),
            schedule_name: "billing.rollup",
          },
        ]);
      } finally {
        Date.now = realDateNow;
        host.close();
      }
    }, 30000);

    test("boots the todo-ts example against Postgres", async () => {
      const database = await postgres.createDatabase("todo_ts");
      const fixture = await createTodoTsFixture("postgres");
      cleanupFixtures.push(fixture);

      const seedOutput = await runTodoTsAction(
        fixture.projectDir,
        "seedDemoWorkspace",
        [],
        postgresEnv(database.url),
      );
      const listOutput = await runTodoTsAction(
        fixture.projectDir,
        "listProjects",
        [],
        postgresEnv(database.url),
      );

      expect(seedOutput).toContain("executed action seedDemoWorkspace");
      expect(listOutput).toContain("operations-platform");
    }, 30000);

    test("boots the todo-ts-decorators example against Postgres", async () => {
      const database = await postgres.createDatabase("todo_ts_decorators");
      const fixture = await createTodoTsDecoratorsFixture("postgres");
      cleanupFixtures.push(fixture);

      const seedOutput = await runTodoTsDecoratorsAction(
        fixture.projectDir,
        "seedDemoWorkspace",
        [],
        postgresEnv(database.url),
      );
      const listOutput = await runTodoTsDecoratorsAction(
        fixture.projectDir,
        "listProjects",
        [],
        postgresEnv(database.url),
      );

      expect(seedOutput).toContain("executed action seedDemoWorkspace");
      expect(listOutput).toContain("operations-platform");
    }, 30000);

    test("boots the todo-ts-nestjs example against Postgres", async () => {
      const database = await postgres.createDatabase("todo_ts_nestjs");
      const fixture = await createTodoTsNestjsFixture("postgres");
      cleanupFixtures.push(fixture);

      const seedOutput = await runTodoTsNestjsAction(
        fixture.projectDir,
        "seedDemoWorkspace",
        [],
        postgresEnv(database.url),
      );
      const listOutput = await runTodoTsNestjsAction(
        fixture.projectDir,
        "listProjects",
        [],
        postgresEnv(database.url),
      );

      expect(seedOutput).toContain("executed action seedDemoWorkspace");
      expect(listOutput).toContain("operations-platform");
    }, 30000);

    test("boots the todo-ts-nestjs-decorators example against Postgres", async () => {
      const database = await postgres.createDatabase("todo_ts_nestjs_decorators");
      const fixture = await createTodoTsNestjsDecoratorsFixture("postgres");
      cleanupFixtures.push(fixture);

      const seedOutput = await runTodoTsNestjsDecoratorsAction(
        fixture.projectDir,
        "seedDemoWorkspace",
        [],
        postgresEnv(database.url),
      );
      const listOutput = await runTodoTsNestjsDecoratorsAction(
        fixture.projectDir,
        "listProjects",
        [],
        postgresEnv(database.url),
      );

      expect(seedOutput).toContain("executed action seedDemoWorkspace");
      expect(listOutput).toContain("operations-platform");
    }, 30000);
  });
}

function postgresEnv(databaseUrl: string): Record<string, string> {
  return {
    CHIMPBASE_STORAGE_ENGINE: "postgres",
    DATABASE_URL: databaseUrl,
    TODO_NOTIFIER_SENDER: "alerts@postgres.test",
  };
}

async function waitFor<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const value = await load();
    if (predicate(value)) {
      return value;
    }

    await Bun.sleep(intervalMs);
  }

  throw new Error(`condition not met within ${timeoutMs}ms`);
}

async function createRuntimeFixture(label: string, databaseUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-postgres-runtime-${label}-`));
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
      '  project: { name: "todo-ts-postgres-test" },',
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
  await writeFile(resolve(dir, ".env"), "TODO_NOTIFIER_SENDER=alerts@postgres.test\n");

  await cp(resolve(exampleDir, "node_modules/hono"), resolve(dir, "node_modules/hono"), { recursive: true });

  return dir;
}

async function createKyselyFixture(label: string, databaseUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-postgres-kysely-${label}-`));
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
      '    postgres: [{ name: "001_init", sql: "CREATE TABLE accounts (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" }],',
      "  },",
      '  project: { name: "postgres-kysely-test" },',
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

async function createCronFixture(label: string, databaseUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-postgres-cron-${label}-`));
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
      'import { action, cron } from "@chimpbase/runtime";',
      "",
      "export default {",
      "  migrations: {",
      '    postgres: [{ name: "001_init", sql: "CREATE TABLE cron_audit (id BIGSERIAL PRIMARY KEY, schedule_name TEXT NOT NULL, fire_at_ms BIGINT NOT NULL);" }],',
      "  },",
      '  project: { name: "postgres-cron-test" },',
      '  worker: { retryDelayMs: 0 },',
      "  registrations: [",
      '    cron("billing.rollup", "*/5 * * * *", async (ctx, invocation) => {',
      '      const shouldFail = await ctx.kv.get("cron:billing.rollup:fail");',
      '      if (shouldFail) {',
      '        throw new Error("boom");',
      "      }",
      '      await ctx.db.query("INSERT INTO cron_audit (schedule_name, fire_at_ms) VALUES (?1, ?2)", [invocation.name, invocation.fireAtMs]);',
      "    }),",
      '    action("listCronAudit", async (ctx) => await ctx.db.query("SELECT schedule_name, fire_at_ms::double precision AS fire_at_ms FROM cron_audit ORDER BY fire_at_ms ASC")),',
      '    action("listCronSchedules", async (ctx) => await ctx.db.query("SELECT schedule_name, cron_expression, next_fire_at_ms::double precision AS next_fire_at_ms FROM _chimpbase_cron_schedules ORDER BY schedule_name ASC")),',
      '    action("setCronFailure", async (ctx, enabled) => {',
      "      if (enabled) {",
      '        await ctx.kv.set("cron:billing.rollup:fail", true);',
      "      } else {",
      '        await ctx.kv.delete("cron:billing.rollup:fail");',
      "      }",
      "      return { enabled };",
      "    }),",
      "  ],",
      "};",
    ].join("\n"),
  );

  return dir;
}

async function createWorkflowFixture(label: string, databaseUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-postgres-workflow-${label}-`));
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
      'import { action, workflow, workflowActionStep, workflowSleepStep, workflowWaitForSignalStep } from "@chimpbase/runtime";',
      "",
      "const onboardingWorkflow = workflow({",
      '  name: "customer.onboarding",',
      "  version: 1,",
      "  initialState(input) {",
      "    return {",
      "      activated: false,",
      "      customerId: input.customerId,",
      "      kickoffCompletedAt: null,",
      "      provisioned: false,",
      "    };",
      "  },",
      "  steps: [",
      '    workflowActionStep("provision-account", "provisionCustomer", {',
      "      args: ({ input }) => [input.customerId],",
      "      onResult: ({ state }) => ({ ...state, provisioned: true }),",
      "    }),",
      '    workflowSleepStep("wait-a-beat", 15),',
      '    workflowWaitForSignalStep("wait-kickoff", "kickoff.completed", {',
      "      onSignal: ({ payload, state }) => ({ ...state, kickoffCompletedAt: payload.completedAt }),",
      "      timeoutMs: 100,",
      '      onTimeout: "fail",',
      "    }),",
      '    workflowActionStep("activate-account", "activateCustomer", {',
      "      args: ({ state }) => [state.customerId],",
      "      onResult: ({ state }) => ({ ...state, activated: true }),",
      "    }),",
      "  ],",
      "});",
      "",
      "export default {",
      '  project: { name: "workflow-postgres-test" },',
      "  registrations: [",
      "    onboardingWorkflow,",
      '    action("provisionCustomer", async (ctx, customerId) => {',
      '      await ctx.collection.insert("workflow_audit", { customerId, step: "provision" });',
      '      return { status: "ok" };',
      "    }),",
      '    action("activateCustomer", async (ctx, customerId) => {',
      '      await ctx.collection.insert("workflow_audit", { customerId, step: "activate" });',
      '      return { status: "ok" };',
      "    }),",
      '    action("startOnboarding", async (ctx, customerId) => {',
      '      return await ctx.workflow.start("customer.onboarding", { customerId }, { workflowId: `workflow:${customerId}` });',
      "    }),",
      '    action("signalKickoffCompleted", async (ctx, customerId, completedAt) => {',
      '      await ctx.workflow.signal(`workflow:${customerId}`, "kickoff.completed", { completedAt });',
      "      return { ok: true };",
      "    }),",
      '    action("getOnboarding", async (ctx, customerId) => await ctx.workflow.get(`workflow:${customerId}`)),',
      "  ],",
      "};",
    ].join("\n"),
  );

  return dir;
}

async function createImperativeWorkflowFixture(label: string, databaseUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-postgres-${label}-`));
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
      'import { action, workflow } from "@chimpbase/runtime";',
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
      "export default {",
      '  project: { name: "workflow-machine-postgres-test" },',
      "  registrations: [",
      "    onboardingWorkflow,",
      '    action("provisionCustomer", async (ctx, customerId) => {',
      '      await ctx.collection.insert("workflow_machine_audit", { customerId, step: "provision" });',
      '      return { status: "ok" };',
      "    }),",
      '    action("activateCustomer", async (ctx, customerId) => {',
      '      await ctx.collection.insert("workflow_machine_audit", { customerId, step: "activate" });',
      '      return { status: "ok" };',
      "    }),",
      '    action("startOnboardingMachine", async (ctx, customerId) => {',
      '      return await ctx.workflow.start("customer.onboarding.machine", { customerId }, { workflowId: `workflow-machine:${customerId}` });',
      "    }),",
      '    action("signalMachineKickoffCompleted", async (ctx, customerId, completedAt) => {',
      '      await ctx.workflow.signal(`workflow-machine:${customerId}`, "kickoff.completed", { completedAt });',
      "      return { ok: true };",
      "    }),",
      '    action("getOnboardingMachine", async (ctx, customerId) => await ctx.workflow.get(`workflow-machine:${customerId}`)),',
      "  ],",
      "};",
    ].join("\n"),
  );

  return dir;
}
