import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  defineChimpbaseApp,
  defineChimpbaseMigration,
  defineChimpbaseMigrations,
  normalizeProjectConfig,
} from "../packages/core/index.ts";
import { createChimpbase } from "../packages/bun/src/library.ts";
import { ChimpbaseBunHost } from "../packages/bun/src/runtime.ts";
import { action, v } from "../packages/runtime/index.ts";

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
      CHIMPBASE_WORKER_CONCURRENCY: process.env.CHIMPBASE_WORKER_CONCURRENCY,
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
    process.env.CHIMPBASE_WORKER_CONCURRENCY = "3";
    process.env.CHIMPBASE_WORKER_LEASE_MS = "41000";
    process.env.CHIMPBASE_WORKER_MAX_ATTEMPTS = "7";
    process.env.CHIMPBASE_WORKER_POLL_INTERVAL_MS = "500";
    process.env.CHIMPBASE_WORKER_RETRY_DELAY_MS = "1200";

    try {
      await writeFile(
        resolve(projectDir, "chimpbase.app.ts"),
        [
          "export default {",
          '  project: { name: "explicit-app" },',
          "  registrations: [],",
          "};",
        ].join("\n"),
      );
      const host = await createChimpbase.from(projectDir, {});

      expect(host.config.project.name).toBe("explicit-app");
      expect(host.config.server.port).toBe(4310);
      expect(host.config.storage.engine).toBe("memory");
      expect(host.config.storage.path).toBeNull();
      expect(host.config.worker).toEqual({
        concurrency: 3,
        leaseMs: 41000,
        maxAttempts: 5,
        pollIntervalMs: 500,
        retryDelayMs: 1000,
      });

      host.close();
    } finally {
      restoreEnv(previousEnv);
    }
  });

  test("accepts explicit platform, secrets and migration sources", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-host-contract-"));
    cleanupDirs.push(projectDir);

    let now = Date.UTC(2026, 2, 11, 10, 0, 0);
    let nextUuid = 0;
    const host = await ChimpbaseBunHost.create({
      config: normalizeProjectConfig({
        project: { name: "host-contract" },
        storage: {
          engine: "sqlite",
          path: "data/host-contract.db",
        },
        worker: {
          retryDelayMs: 0,
        },
      }),
      migrationSource: {
        async list() {
          return [
            {
              name: "001_worker_audit.sql",
              sql: "CREATE TABLE IF NOT EXISTS worker_audit (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
            },
          ];
        },
      },
      platform: {
        hashString(input) {
          return `hash:${input}`;
        },
        now() {
          return now;
        },
        randomUUID() {
          nextUuid += 1;
          return `uuid-${nextUuid}`;
        },
      },
      projectDir,
      secrets: {
        get(name: string) {
          return name === "API_TOKEN" ? "secret-token" : null;
        },
      },
    });

    host.registerAction("readSecret", async (ctx, name) => ctx.secret(name as string));
    host.registerAction("createNote", async (ctx, value) => ({
      id: await ctx.collection.insert("notes", { value }),
    }));
    host.registerAction("enqueueAudit", async (ctx, value, delayMs) => {
      await ctx.queue.enqueue("audit.job", { value }, { delayMs: delayMs as number });
      return null;
    });
    host.registerAction(
      "listAudit",
      async (ctx) => await ctx.query("SELECT value FROM worker_audit ORDER BY id ASC"),
    );
    host.registerWorker("audit.job", async (ctx, payload) => {
      await ctx.query("INSERT INTO worker_audit (value) VALUES (?1)", [(payload as { value: string }).value]);
    });

    try {
      const secret = await host.executeAction("readSecret", ["API_TOKEN"]);
      expect(secret.result).toBe("secret-token");
      expect(host.platform.hashString("chimpbase")).toBe("hash:chimpbase");

      const created = await host.executeAction("createNote", ["note-1"]);
      expect(created.result).toEqual({ id: "uuid-1" });

      await host.executeAction("enqueueAudit", ["delayed-job", 5_000]);

      const beforeDrain = await host.drain();
      expect(beforeDrain).toEqual({
        cronSchedules: 0,
        idle: true,
        queueJobs: 0,
        runs: 0,
        stopReason: "idle",
      });

      now += 5_000;

      const afterDrain = await host.drain();
      expect(afterDrain).toEqual({
        cronSchedules: 0,
        idle: true,
        queueJobs: 1,
        runs: 1,
        stopReason: "idle",
      });

      const audit = await host.executeAction("listAudit");
      expect(audit.result).toEqual([{ value: "delayed-job" }]);
    } finally {
      host.close();
    }
  });

  test("supports validator-backed action references", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-action-refs-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      app: defineChimpbaseApp({
        project: { name: "action-refs" },
      }),
      projectDir,
      storage: {
        engine: "sqlite",
        path: "data/action-refs.db",
      },
    });

    const createAccount = action({
      args: v.object({
        email: v.string(),
        name: v.string(),
      }),
      async handler(_ctx, input) {
        return {
          email: input.email,
          name: input.name,
          slug: input.name.toLowerCase(),
        };
      },
      name: "createAccountRef",
    });

    const seedAccounts = action({
      args: v.object({
        accounts: v.array(
          v.object({
            email: v.string(),
            name: v.string(),
          }),
        ),
      }),
      async handler(_ctx, input) {
        const created = [];
        for (const account of input.accounts) {
          created.push(await createAccount(account));
        }

        return {
          created,
          total: created.length,
        };
      },
      name: "seedAccountsRef",
    });

    try {
      await expect(
        createAccount({
          email: "outside@test.dev",
          name: "Outside",
        }),
      ).rejects.toThrow("requires an active chimpbase runtime context or a registered host binding");

      host.register(createAccount, seedAccounts);

      await expect(createAccount({
        email: "bound@test.dev",
        name: "Bound",
      })).resolves.toEqual({
        email: "bound@test.dev",
        name: "Bound",
        slug: "bound",
      });

      const seeded = await host.executeAction(seedAccounts, {
        accounts: [
          { email: "alice@test.dev", name: "Alice" },
          { email: "bruno@test.dev", name: "Bruno" },
        ],
      });

      expect(seeded.result).toEqual({
        created: [
          { email: "alice@test.dev", name: "Alice", slug: "alice" },
          { email: "bruno@test.dev", name: "Bruno", slug: "bruno" },
        ],
        total: 2,
      });

      const seededByName = await host.executeAction("seedAccountsRef", {
        accounts: [{ email: "carol@test.dev", name: "Carol" }],
      });
      expect(seededByName.result).toEqual({
        created: [{ email: "carol@test.dev", name: "Carol", slug: "carol" }],
        total: 1,
      });

      await expect(
        host.executeAction(createAccount, {
          email: 42,
          name: "Broken",
        } as never),
      ).rejects.toThrow("args.email must be a string");
    } finally {
      host.close();
    }
  });

  test("fails clearly when registering an unnamed action outside app module loading", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-unnamed-action-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      app: defineChimpbaseApp({
        project: { name: "unnamed-action" },
      }),
      projectDir,
      storage: {
        engine: "memory",
      },
    });

    const health = action({
      async handler() {
        return { ok: true };
      },
    });

    try {
      expect(() => host.register(health)).toThrow(
        "unnamed action registration cannot be registered or referenced yet",
      );
    } finally {
      host.close();
    }
  });

  test("infers an unnamed action name from register({ key })", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-register-map-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      app: defineChimpbaseApp({
        project: { name: "register-map" },
      }),
      projectDir,
      storage: {
        engine: "memory",
      },
    });

    const health = action({
      async handler() {
        return { ok: true };
      },
    });

    try {
      host.register({ health });

      expect(health.name).toBe("health");
      await expect(health()).resolves.toEqual({ ok: true });

      const outcome = await host.executeAction("health");
      expect(outcome.result).toEqual({ ok: true });
    } finally {
      host.close();
    }
  });

  test("emits runtime debug logs when enabled", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-debug-logs-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      app: defineChimpbaseApp({
        project: { name: "debug-logs" },
      }),
      debug: true,
      projectDir,
      storage: {
        engine: "memory",
      },
    });

    host.registerAction("health", async () => ({ ok: true }));

    const originalConsoleDebug = console.debug;
    const debugCalls: unknown[][] = [];
    console.debug = (...args: unknown[]) => {
      debugCalls.push(args);
    };

    const started = host.start({ runWorker: false, serve: false });

    try {
      await host.executeAction("health");
      await started.stop();
      expect(debugCalls.some((call) => call[0] === "[@chimpbase/bun][debug]" && call[1] === "runtime starting")).toBe(true);
      expect(debugCalls.some((call) => call[0] === "[@chimpbase/bun][debug]" && call[1] === "action executing")).toBe(true);
      expect(debugCalls.some(
        (call) => call[0] === "[@chimpbase/bun][debug]"
          && call[1] === "action completed"
          && (call[2] as { name?: string })?.name === "health",
      )).toBe(true);
      expect(debugCalls.some((call) => call[0] === "[@chimpbase/bun][debug]" && call[1] === "runtime stopped")).toBe(true);
    } finally {
      host.close();
      console.debug = originalConsoleDebug;
    }
  });

  test("allows calling registered action refs while the sqlite worker loop is active", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-direct-action-worker-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      app: defineChimpbaseApp({
        project: { name: "direct-action-worker" },
        worker: {
          retryDelayMs: 0,
        },
      }),
      projectDir,
      storage: {
        engine: "sqlite",
        path: "data/direct-action-worker.db",
      },
      workerRuntime: {
        pollIntervalMs: 1,
      },
    });

    const health = action({
      async handler() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true };
      },
      name: "healthDirectWorker",
    });

    host.register(health);

    const originalConsoleError = console.error;
    const workerErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      workerErrors.push(args);
    };

    const started = host.start({ serve: false });

    try {
      await expect(health()).resolves.toEqual({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(workerErrors).toEqual([]);
    } finally {
      console.error = originalConsoleError;
      await started.stop();
      host.close();
    }
  });

  test("accepts typed TS migrations in createChimpbase options", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-typed-migrations-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      app: defineChimpbaseApp({
        migrations: defineChimpbaseMigrations({
          sqlite: [
            defineChimpbaseMigration({
              name: "001_worker_audit",
              sql: "CREATE TABLE IF NOT EXISTS worker_audit (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
            }),
          ],
        }),
        project: { name: "typed-migrations" },
        worker: {
          retryDelayMs: 0,
        },
      }),
      projectDir,
      storage: {
        engine: "sqlite",
        path: "data/typed-migrations.db",
      },
    });

    host.registerAction("enqueueAudit", async (ctx, value) => {
      await ctx.queue.enqueue("audit.job", { value });
      return null;
    });
    host.registerAction(
      "listAudit",
      async (ctx) => await ctx.query("SELECT value FROM worker_audit ORDER BY id ASC"),
    );
    host.registerWorker("audit.job", async (ctx, payload) => {
      await ctx.query("INSERT INTO worker_audit (value) VALUES (?1)", [(payload as { value: string }).value]);
    });

    try {
      await host.executeAction("enqueueAudit", ["typed-migration"]);

      expect(await host.drain()).toEqual({
        cronSchedules: 0,
        idle: true,
        queueJobs: 1,
        runs: 1,
        stopReason: "idle",
      });

      const audit = await host.executeAction("listAudit");
      expect(audit.result).toEqual([{ value: "typed-migration" }]);
    } finally {
      host.close();
    }
  });

  test("accepts inline app fields with registrations", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-app-definition-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      migrations: defineChimpbaseMigrations({
        sqlite: [
          defineChimpbaseMigration({
            name: "001_worker_audit",
            sql: "CREATE TABLE IF NOT EXISTS worker_audit (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
          }),
        ],
      }),
      projectDir,
      project: { name: "app-definition" },
      registrations: [
        {
          eventName: "audit.created",
          handler: async (ctx, event) => {
            await ctx.queue.enqueue("audit.job", event);
          },
          kind: "subscription",
        },
        action("enqueueAudit", async (ctx, value) => {
          ctx.pubsub.publish("audit.created", { value });
          return { queued: value };
        }),
        action("listAudit", async (ctx) => await ctx.query("SELECT value FROM worker_audit ORDER BY id ASC")),
        {
          definition: undefined,
          handler: async (ctx, payload) => {
            await ctx.query("INSERT INTO worker_audit (value) VALUES (?1)", [(payload as { value: string }).value]);
          },
          kind: "worker",
          name: "audit.job",
        },
      ],
      storage: {
        engine: "sqlite",
        path: "data/app-definition.db",
      },
      workerRuntime: {
        pollIntervalMs: 25,
      },
    });

    try {
      const queued = await host.executeAction("enqueueAudit", ["from-app"]);
      expect(queued.result).toEqual({ queued: "from-app" });

      expect(await host.drain()).toEqual({
        cronSchedules: 0,
        idle: true,
        queueJobs: 1,
        runs: 1,
        stopReason: "idle",
      });

      const audit = await host.executeAction("listAudit");
      expect(audit.result).toEqual([{ value: "from-app" }]);
    } finally {
      host.close();
    }
  });

  test("supports host action and worker registration helpers", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-host-helpers-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      storage: {
        engine: "memory",
      },
    });

    host
      .action("enqueueAudit", async (ctx, value) => {
        await ctx.queue.enqueue("audit.job", { value });
        return { queued: value };
      })
      .action(
        "listAudit",
        async (ctx) => await ctx.collection.find("audit_log"),
      )
      .worker("audit.job", async (ctx, payload) => {
        await ctx.collection.insert("audit_log", { value: (payload as { value: string }).value });
      });

    try {
      const queued = await host.executeAction("enqueueAudit", ["from-helper"]);
      expect(queued.result).toEqual({ queued: "from-helper" });

      expect(await host.drain()).toEqual({
        cronSchedules: 0,
        idle: true,
        queueJobs: 1,
        runs: 1,
        stopReason: "idle",
      });

      const audit = await host.executeAction("listAudit");
      expect(audit.result).toEqual([
        expect.objectContaining({ value: "from-helper" }),
      ]);
    } finally {
      host.close();
    }
  });

  test("drain stops at maxRuns and can resume later", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-drain-"));
    cleanupDirs.push(projectDir);

    const processed: string[] = [];
    const host = await ChimpbaseBunHost.create({
      config: normalizeProjectConfig({
        project: { name: "drain-contract" },
        storage: { engine: "memory" },
        worker: { retryDelayMs: 0 },
      }),
      platform: {
        hashString(input) {
          return `hash:${input}`;
        },
        now() {
          return Date.UTC(2026, 2, 11, 11, 0, 0);
        },
        randomUUID() {
          return "uuid-drain";
        },
      },
      projectDir,
      secrets: {
        get() {
          return null;
        },
      },
    });

    host.registerAction("enqueueJobs", async (ctx) => {
      await ctx.queue.enqueue("batch.job", { value: "job-1" });
      await ctx.queue.enqueue("batch.job", { value: "job-2" });
      return null;
    });
    host.registerWorker("batch.job", async (_ctx, payload) => {
      processed.push((payload as { value: string }).value);
    });

    try {
      await host.executeAction("enqueueJobs");

      const firstDrain = await host.drain({ maxRuns: 1 });
      expect(firstDrain).toEqual({
        cronSchedules: 0,
        idle: false,
        queueJobs: 1,
        runs: 1,
        stopReason: "max_runs",
      });
      expect(processed).toEqual(["job-1"]);

      const secondDrain = await host.drain();
      expect(secondDrain).toEqual({
        cronSchedules: 0,
        idle: true,
        queueJobs: 1,
        runs: 1,
        stopReason: "idle",
      });
      expect(processed).toEqual(["job-1", "job-2"]);
    } finally {
      host.close();
    }
  });

  test("drain alternates between due cron schedules and queue jobs", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-drain-fairness-"));
    cleanupDirs.push(projectDir);

    let now = Date.UTC(2026, 2, 11, 11, 0, 0);
    const host = await ChimpbaseBunHost.create({
      config: normalizeProjectConfig({
        project: { name: "drain-fairness" },
        storage: {
          engine: "sqlite",
          path: "data/drain-fairness.db",
        },
        worker: {
          retryDelayMs: 0,
        },
      }),
      platform: {
        hashString(input) {
          return `hash:${input}`;
        },
        now() {
          return now;
        },
        randomUUID() {
          return crypto.randomUUID();
        },
      },
      projectDir,
      secrets: {
        get() {
          return null;
        },
      },
    });

    host.registerAction("enqueueJob", async (ctx) => {
      await ctx.queue.enqueue("batch.job", { value: "job-1" });
      return null;
    });
    host.registerAction(
      "listCronSchedules",
      async (ctx) =>
        await ctx.query<{ next_fire_at_ms: number }>(
          "SELECT next_fire_at_ms FROM _chimpbase_cron_schedules ORDER BY schedule_name ASC",
        ),
    );
    host.registerWorker("batch.job", async () => {});
    host.registerCron("alpha.rollup", "*/5 * * * *", async () => null);
    host.registerCron("beta.rollup", "*/5 * * * *", async () => null);

    try {
      await host.syncCronSchedules();
      const schedules = await host.executeAction("listCronSchedules");
      const [{ next_fire_at_ms: dueAtMs }] = schedules.result as Array<{ next_fire_at_ms: number }>;
      now = dueAtMs;

      await host.executeAction("enqueueJob");

      const drained = await host.drain({ maxRuns: 2 });
      expect(drained).toEqual({
        cronSchedules: 1,
        idle: false,
        queueJobs: 1,
        runs: 2,
        stopReason: "max_runs",
      });
    } finally {
      host.close();
    }
  });

  test("preloads secrets from mounted files before env vars and .env", async () => {
    const previousToken = process.env.APP_TOKEN;
    const previousSecretsDir = process.env.CHIMPBASE_SECRETS_DIR;
    const projectDir = await createInlineFixture("secrets-mounted", {
      "chimpbase.app.ts": [
        'import { action } from "@chimpbase/runtime";',
        "",
        "export default {",
        '  project: { name: "secrets-mounted" },',
        "  registrations: [",
        '    action("readSecret", async (ctx, name) => ctx.secret(name)),',
        "  ],",
        "};",
      ].join("\n"),
    }, []);

    try {
      await writeFile(resolve(projectDir, ".env"), "APP_TOKEN=dotenv-token\n");
      await mkdir(resolve(projectDir, "run/secrets"), { recursive: true });
      await writeFile(resolve(projectDir, "run/secrets/APP_TOKEN"), "mounted-token");
      process.env.APP_TOKEN = "env-token";
      process.env.CHIMPBASE_SECRETS_DIR = "run/secrets";

      const host = await ChimpbaseBunHost.load(projectDir);

      try {
        const secret = await host.executeAction("readSecret", ["APP_TOKEN"]);
        expect(secret.result).toBe("mounted-token");
      } finally {
        host.close();
      }
    } finally {
      if (previousSecretsDir === undefined) {
        delete process.env.CHIMPBASE_SECRETS_DIR;
      } else {
        process.env.CHIMPBASE_SECRETS_DIR = previousSecretsDir;
      }
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
      "chimpbase.app.ts": [
        'import { action } from "@chimpbase/runtime";',
        "",
        "export default {",
        '  project: { name: "secrets-dotenv" },',
        "  registrations: [",
        '    action("readSecret", async (ctx, name) => ctx.secret(name)),',
        "  ],",
        "};",
      ].join("\n"),
    }, []);

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

  test("can dispatch subscriptions asynchronously through the internal queue", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "chimpbase-bun-async-subscriptions-"));
    cleanupDirs.push(projectDir);

    const host = await createChimpbase({
      project: { name: "async-subscriptions" },
      projectDir,
      storage: {
        engine: "sqlite",
        path: "data/async-subscriptions.db",
      },
      subscriptions: {
        dispatch: "async",
      },
    });

    host.registerAction("emitAudit", async (ctx, value) => {
      ctx.pubsub.publish("audit.created", { value });
      return { ok: true };
    });
    host.registerAction("prepareAuditTable", async (ctx) => {
      await ctx.query("CREATE TABLE IF NOT EXISTS async_audit (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      return null;
    });
    host.registerAction(
      "listAudit",
      async (ctx) => await ctx.query("SELECT value FROM async_audit ORDER BY id ASC"),
    );
    host.registerSubscription("audit.created", async (ctx, payload) => {
      await ctx.query("INSERT INTO async_audit (value) VALUES (?1)", [(payload as { value: string }).value]);
    }, { name: "onAuditCreated" });

    try {
      await host.executeAction("prepareAuditTable");
      const emitted = await host.executeAction("emitAudit", ["from-async"]);
      expect(emitted.emittedEvents).toEqual([
        expect.objectContaining({ name: "audit.created" }),
      ]);

      const beforeDrain = await host.executeAction("listAudit");
      expect(beforeDrain.result).not.toContainEqual({ value: "from-async" });

      const queueResult = await host.processNextQueueJob();
      expect(queueResult?.queueName).toBe("__chimpbase.subscription.run");

      const afterDrain = await host.executeAction("listAudit");
      expect(afterDrain.result).toContainEqual({ value: "from-async" });
    } finally {
      host.close();
    }
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
      await host.executeAction("startTodo", { todoId });
      await host.executeAction("completeTodo", { todoId });
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
      "chimpbase.app.ts": [
        'import { action, workflow, workflowActionStep, workflowSleepStep, workflowWaitForSignalStep } from "@chimpbase/runtime";',
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
        "export default {",
        '  project: { name: "workflow-mvp" },',
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
        '    action("listWorkflowAudit", async (ctx) => await ctx.collection.find("workflow_audit")),',
        "  ],",
        "};",
      ].join("\n"),
    }, []);

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

  test("loads exported unnamed actions and workflow refs from chimpbase.app.ts", async () => {
    const projectDir = await createInlineFixture("workflow-unnamed-actions", {
      "chimpbase.app.ts": [
        'import { action, workflow, workflowActionStep } from "@chimpbase/runtime";',
        "",
        "export const createGreeting = action({",
        "  async handler(ctx, name) {",
        '    await ctx.collection.insert("workflow_named_audit", { name, step: "create" });',
        '    return { greeting: `hello ${name}` };',
        "  },",
        "});",
        "",
        "export const greetingWorkflow = workflow({",
        '  name: "greeting.workflow",',
        "  version: 1,",
        "  initialState(input) {",
        "    return {",
        "      greeting: null,",
        "      name: input.name,",
        "    };",
        "  },",
        "  steps: [",
        '    workflowActionStep("create-greeting", createGreeting, {',
        "      args: ({ input }) => [input.name],",
        "      onResult: ({ result, state }) => ({ ...state, greeting: result.greeting }),",
        "    }),",
        "  ],",
        "});",
        "",
        "export const startGreetingWorkflow = action({",
        "  async handler(ctx, name) {",
        '    return await ctx.workflow.start("greeting.workflow", { name }, { workflowId: `greeting:${name}` });',
        "  },",
        "});",
        "",
        "export const getGreetingWorkflow = action({",
        "  async handler(ctx, name) {",
        '    return await ctx.workflow.get(`greeting:${name}`);',
        "  },",
        "});",
        "",
        "export default {",
        '  project: { name: "workflow-unnamed-actions" },',
        "  registrations: [",
        "    createGreeting,",
        "    greetingWorkflow,",
        "    startGreetingWorkflow,",
        "    getGreetingWorkflow,",
        "  ],",
        "};",
      ].join("\n"),
    }, []);

    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      const started = await host.executeAction("chimpbase.app.ts#startGreetingWorkflow", ["alice"]);
      expect(started.result).toEqual({
        status: "running",
        workflowId: "greeting:alice",
        workflowName: "greeting.workflow",
        workflowVersion: 1,
      });

      const run = await host.processNextQueueJob();
      expect(run?.queueName).toBe("__chimpbase.workflow.run");

      const instance = await host.executeAction("chimpbase.app.ts#getGreetingWorkflow", ["alice"]);
      expect(instance.result).toEqual(
        expect.objectContaining({
          currentStepId: null,
          state: {
            greeting: "hello alice",
            name: "alice",
          },
          status: "completed",
        }),
      );
    } finally {
      host.close();
    }
  });

  test("executes imperative durable workflows with switch-based state transitions", async () => {
    const projectDir = await createInlineFixture("workflow-imperative", {
      "chimpbase.app.ts": [
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
        '  project: { name: "workflow-imperative" },',
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
        '    action("listWorkflowMachineAudit", async (ctx) => await ctx.collection.find("workflow_machine_audit")),',
        "  ],",
        "};",
      ].join("\n"),
    }, []);

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

  test("schedules durable cron runs and advances the next fire before handler retries", async () => {
    const realDateNow = Date.now;
    let now = Date.UTC(2026, 2, 11, 10, 2, 0);
    Date.now = () => now;

    const projectDir = await createInlineFixture("cron", {
      "chimpbase.app.ts": [
        'import { action, cron } from "@chimpbase/runtime";',
        "",
        "export default {",
        '  migrations: {',
        '    sqlite: [{ name: "001_init", sql: "CREATE TABLE IF NOT EXISTS cron_audit (id INTEGER PRIMARY KEY, schedule_name TEXT NOT NULL, fire_at_ms INTEGER NOT NULL, fire_at_iso TEXT NOT NULL);" }],',
        "  },",
        '  project: { name: "cron-test" },',
        '  worker: { retryDelayMs: 0 },',
        "  registrations: [",
        '    cron("billing.rollup", "*/5 * * * *", async (ctx, invocation) => {',
        '      const shouldFail = await ctx.kv.get("cron:billing.rollup:fail");',
        '      if (shouldFail) {',
        '        throw new Error("boom");',
        "      }",
        "      await ctx.query(",
        '        "INSERT INTO cron_audit (schedule_name, fire_at_ms, fire_at_iso) VALUES (?1, ?2, ?3)",',
        "        [invocation.name, invocation.fireAtMs, invocation.fireAt],",
        "      );",
        "    }),",
        '    action("listCronAudit", async (ctx) => await ctx.query("SELECT schedule_name, fire_at_ms, fire_at_iso FROM cron_audit ORDER BY fire_at_ms ASC")),',
        '    action("listCronSchedules", async (ctx) => await ctx.query("SELECT schedule_name, cron_expression, next_fire_at_ms FROM _chimpbase_cron_schedules ORDER BY schedule_name ASC")),',
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
    }, [
      "[project]",
      'name = "cron-test"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/cron.db"',
      "",
      "[worker]",
      "retry_delay_ms = 0",
      "",
    ]);

    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      await host.syncCronSchedules();

      const initialSchedules = await host.executeAction("listCronSchedules");
      expect(initialSchedules.result).toEqual([
        {
          cron_expression: "*/5 * * * *",
          next_fire_at_ms: Date.UTC(2026, 2, 11, 10, 5, 0),
          schedule_name: "billing.rollup",
        },
      ]);

      expect(await host.processNextCronSchedule()).toBeNull();

      now = Date.UTC(2026, 2, 11, 10, 5, 0);
      const firstSchedule = await host.processNextCronSchedule();
      expect(firstSchedule).toEqual({
        fireAt: "2026-03-11T10:05:00.000Z",
        fireAtMs: Date.UTC(2026, 2, 11, 10, 5, 0),
        nextFireAt: "2026-03-11T10:10:00.000Z",
        nextFireAtMs: Date.UTC(2026, 2, 11, 10, 10, 0),
        scheduleName: "billing.rollup",
      });

      expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");

      const firstAudit = await host.executeAction("listCronAudit");
      expect(firstAudit.result).toEqual([
        {
          fire_at_iso: "2026-03-11T10:05:00.000Z",
          fire_at_ms: Date.UTC(2026, 2, 11, 10, 5, 0),
          schedule_name: "billing.rollup",
        },
      ]);

      await host.executeAction("setCronFailure", [true]);

      now = Date.UTC(2026, 2, 11, 10, 10, 0);
      const secondSchedule = await host.processNextCronSchedule();
      expect(secondSchedule).toEqual({
        fireAt: "2026-03-11T10:10:00.000Z",
        fireAtMs: Date.UTC(2026, 2, 11, 10, 10, 0),
        nextFireAt: "2026-03-11T10:15:00.000Z",
        nextFireAtMs: Date.UTC(2026, 2, 11, 10, 15, 0),
        scheduleName: "billing.rollup",
      });

      await expect(host.processNextQueueJob()).rejects.toThrow("boom");

      const schedulesAfterFailure = await host.executeAction("listCronSchedules");
      expect(schedulesAfterFailure.result).toEqual([
        {
          cron_expression: "*/5 * * * *",
          next_fire_at_ms: Date.UTC(2026, 2, 11, 10, 15, 0),
          schedule_name: "billing.rollup",
        },
      ]);

      now = Date.UTC(2026, 2, 11, 10, 15, 0);
      const thirdSchedule = await host.processNextCronSchedule();
      expect(thirdSchedule).toEqual({
        fireAt: "2026-03-11T10:15:00.000Z",
        fireAtMs: Date.UTC(2026, 2, 11, 10, 15, 0),
        nextFireAt: "2026-03-11T10:20:00.000Z",
        nextFireAtMs: Date.UTC(2026, 2, 11, 10, 20, 0),
        scheduleName: "billing.rollup",
      });

      await host.executeAction("setCronFailure", [false]);

      expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");
      expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");

      const finalAudit = await host.executeAction("listCronAudit");
      expect(finalAudit.result).toEqual([
        {
          fire_at_iso: "2026-03-11T10:05:00.000Z",
          fire_at_ms: Date.UTC(2026, 2, 11, 10, 5, 0),
          schedule_name: "billing.rollup",
        },
        {
          fire_at_iso: "2026-03-11T10:10:00.000Z",
          fire_at_ms: Date.UTC(2026, 2, 11, 10, 10, 0),
          schedule_name: "billing.rollup",
        },
        {
          fire_at_iso: "2026-03-11T10:15:00.000Z",
          fire_at_ms: Date.UTC(2026, 2, 11, 10, 15, 0),
          schedule_name: "billing.rollup",
        },
      ]);
    } finally {
      Date.now = realDateNow;
      host.close();
    }
  });

  test("skips missed cron fires and resumes from the current slot", async () => {
    const realDateNow = Date.now;
    let now = Date.UTC(2026, 2, 11, 10, 2, 0);
    Date.now = () => now;

    const projectDir = await createInlineFixture("cron-skip-missed", {
      "chimpbase.app.ts": [
        'import { action, cron } from "@chimpbase/runtime";',
        "",
        "export default {",
        '  migrations: {',
        '    sqlite: [{ name: "001_init", sql: "CREATE TABLE IF NOT EXISTS cron_audit (id INTEGER PRIMARY KEY, schedule_name TEXT NOT NULL, fire_at_ms INTEGER NOT NULL, fire_at_iso TEXT NOT NULL);" }],',
        "  },",
        '  project: { name: "cron-skip-missed-test" },',
        '  registrations: [',
        '    cron("billing.rollup", "*/5 * * * *", async (ctx, invocation) => {',
        "      await ctx.query(",
        '        "INSERT INTO cron_audit (schedule_name, fire_at_ms, fire_at_iso) VALUES (?1, ?2, ?3)",',
        "        [invocation.name, invocation.fireAtMs, invocation.fireAt],",
        "      );",
        "    }),",
        '    action("listCronAudit", async (ctx) => await ctx.query("SELECT schedule_name, fire_at_ms, fire_at_iso FROM cron_audit ORDER BY fire_at_ms ASC")),',
        '    action("listCronSchedules", async (ctx) => await ctx.query("SELECT schedule_name, cron_expression, next_fire_at_ms FROM _chimpbase_cron_schedules ORDER BY schedule_name ASC")),',
        "  ],",
        "};",
      ].join("\n"),
    }, [
      "[project]",
      'name = "cron-skip-missed-test"',
      "",
      "[storage]",
      'engine = "sqlite"',
      'path = "data/cron-skip-missed.db"',
      "",
    ]);

    const host = await ChimpbaseBunHost.load(projectDir);

    try {
      await host.syncCronSchedules();

      const initialSchedules = await host.executeAction("listCronSchedules");
      expect(initialSchedules.result).toEqual([
        {
          cron_expression: "*/5 * * * *",
          next_fire_at_ms: Date.UTC(2026, 2, 11, 10, 5, 0),
          schedule_name: "billing.rollup",
        },
      ]);

      now = Date.UTC(2026, 2, 11, 10, 22, 0);
      const resumedSchedule = await host.processNextCronSchedule();
      expect(resumedSchedule).toEqual({
        fireAt: "2026-03-11T10:20:00.000Z",
        fireAtMs: Date.UTC(2026, 2, 11, 10, 20, 0),
        nextFireAt: "2026-03-11T10:25:00.000Z",
        nextFireAtMs: Date.UTC(2026, 2, 11, 10, 25, 0),
        scheduleName: "billing.rollup",
      });

      expect((await host.processNextQueueJob())?.queueName).toBe("__chimpbase.cron.run");
      expect(await host.processNextCronSchedule()).toBeNull();

      const audit = await host.executeAction("listCronAudit");
      expect(audit.result).toEqual([
        {
          fire_at_iso: "2026-03-11T10:20:00.000Z",
          fire_at_ms: Date.UTC(2026, 2, 11, 10, 20, 0),
          schedule_name: "billing.rollup",
        },
      ]);

      const schedulesAfterResume = await host.executeAction("listCronSchedules");
      expect(schedulesAfterResume.result).toEqual([
        {
          cron_expression: "*/5 * * * *",
          next_fire_at_ms: Date.UTC(2026, 2, 11, 10, 25, 0),
          schedule_name: "billing.rollup",
        },
      ]);
    } finally {
      Date.now = realDateNow;
      host.close();
    }
  });

  test("routes failed jobs to a custom dlq", async () => {
    const projectDir = await createInlineFixture("dlq", {
      "chimpbase.app.ts": [
        'import { action, worker } from "@chimpbase/runtime";',
        "",
        "export default {",
        "  migrations: {",
        '    sqlite: [{ name: "001_init", sql: "CREATE TABLE IF NOT EXISTS dlq_captures (id INTEGER PRIMARY KEY, queue_name TEXT NOT NULL, error_message TEXT NOT NULL, attempts INTEGER NOT NULL);" }],',
        "  },",
        '  project: { name: "dlq-test" },',
        "  worker: {",
        "    maxAttempts: 2,",
        "    retryDelayMs: 0,",
        "  },",
        '  registrations: [',
        '    action("enqueueExplodingJob", async (ctx) => {',
        '      await ctx.queue.enqueue("todo.explodes", { todoId: 7 });',
        "      return null;",
        "    }),",
        "",
        '    worker("todo.explodes", async () => {',
        '      throw new Error("boom");',
        "    }, {",
        '      dlq: "todo.explodes.failed"',
        "    }),",
        "",
        '    worker("todo.explodes.failed", async (ctx, envelope) => {',
        "      await ctx.query(",
        '        "INSERT INTO dlq_captures (queue_name, error_message, attempts) VALUES (?1, ?2, ?3)",',
        "        [envelope.queue, envelope.error, envelope.attempts],",
        "      );",
        "    }, {",
        "      dlq: false,",
        "    }),",
        "",
        '    action("listDlqCaptures", async (ctx) => {',
        '      return await ctx.query("SELECT queue_name, error_message, attempts FROM dlq_captures ORDER BY id ASC");',
        "    }),",
        "  ],",
        "};",
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
      "chimpbase.app.ts": [
        'import { Action, Worker, Subscription, registrationsFrom } from "@chimpbase/runtime";',
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
        "export default {",
        "  migrations: {",
        '    sqlite: [{ name: "001_init", sql: "CREATE TABLE IF NOT EXISTS decorated_todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decorated_audit (id INTEGER PRIMARY KEY, todo_id INTEGER NOT NULL, title TEXT NOT NULL);" }],',
        "  },",
        '  project: { name: "decorator-test" },',
        "  registrations: registrationsFrom(DecoratedTodoModule),",
        "};",
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
      "chimpbase.app.ts": [
        'import { Action, Worker, Subscription, registrationsFrom } from "@chimpbase/runtime";',
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
        "",
        "export default {",
        "  migrations: {",
        '    sqlite: [{ name: "001_init", sql: "CREATE TABLE IF NOT EXISTS instance_decorated_todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL); CREATE TABLE IF NOT EXISTS instance_decorated_audit (id INTEGER PRIMARY KEY, todo_id INTEGER NOT NULL, title TEXT NOT NULL);" }],',
        "  },",
        '  project: { name: "decorator-instance-test" },',
        "  registrations: registrationsFrom(moduleInstance),",
        "};",
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
    const preference = await host.executeAction("setWorkspacePreference", {
      key: "timezone",
      value: { label: "America/Sao_Paulo" },
    });
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

    const notes = await host.executeAction("listTodoNotes", { todoId });
    expect(notes.result).toEqual([
      expect.objectContaining({
        body: "Remember to validate collection storage.",
        todoId,
      }),
    ]);

    await host.executeAction("startTodo", { todoId });
    await host.executeAction("completeTodo", { todoId });
    await host.processNextQueueJob();

    const preferences = await host.executeAction("listWorkspacePreferences");
    expect(preferences.result).toEqual([
      {
        key: "workspace.timezone",
        value: { label: "America/Sao_Paulo" },
      },
    ]);

    const activity = await host.executeAction("listTodoActivityStream", {});
    expect((activity.result as Array<{ event: string }>).some((entry) => entry.event === "todo.completed")).toBe(true);

    host.close();
  });

  test("createChimpbase.from prefers chimpbase.app.ts over legacy project discovery", async () => {
    const projectDir = await createInlineFixture("app-module", {
      "chimpbase.app.ts": [
        'import { action } from "@chimpbase/runtime";',
        "",
        "export default {",
        '  project: { name: "app-module" },',
        "  migrations: {",
        "    sqlite: [",
        '      { name: "001_init", sql: "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, value TEXT NOT NULL);" },',
        "    ],",
        "  },",
        "  registrations: [",
        '    action("createNote", async (ctx, value) => {',
        '      await ctx.query("INSERT INTO notes (value) VALUES (?1)", [value]);',
        "      return null;",
        "    }),",
        '    action("listNotes", async (ctx) => await ctx.query("SELECT value FROM notes ORDER BY id ASC")),',
        "  ],",
        "};",
      ].join("\n"),
    }, []);

    const host = await createChimpbase.from(projectDir, {
      storage: {
        engine: "sqlite",
        path: "data/app-module.db",
      },
    });

    try {
      await host.executeAction("createNote", ["from-app-module"]);
      const notes = await host.executeAction("listNotes");
      expect(notes.result).toEqual([{ value: "from-app-module" }]);
    } finally {
      host.close();
    }
  });
});

async function createFixture(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-bun-${label}-`));
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
      '  project: { name: "todo-ts-bun-test" },',
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
  await mkdir(resolve(dir, "node_modules/@chimpbase"), { recursive: true });
  await cp(resolve(runtimeRoot, "packages/core"), resolve(dir, "node_modules/@chimpbase/core"), {
    recursive: true,
  });
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
  _configLines: string[],
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
        include: ["**/*.ts"],
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

  return dir;
}
