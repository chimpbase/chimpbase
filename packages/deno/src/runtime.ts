import { resolve } from "node:path";

import {
  ChimpbaseEngine,
  createDefaultChimpbasePlatformShim,
  createChimpbaseRegistry,
  listChimpbaseMigrationsForEngine,
  type ChimpbaseActionExecutionResult,
  type ChimpbaseCronScheduleExecutionResult,
  type ChimpbaseDrainOptions,
  type ChimpbaseDrainResult,
  type ChimpbaseEntrypointTarget,
  type ChimpbaseEngineAdapter,
  type ChimpbaseMigration,
  type ChimpbaseMigrationsDefinition,
  type ChimpbaseMigrationSource,
  type ChimpbasePlatformShim,
  type ChimpbaseProjectConfig,
  type ChimpbaseQueueExecutionResult,
  type ChimpbaseRegistry,
  type ChimpbaseRouteExecutionResult,
  type ChimpbaseSecretsSource,
  type ChimpbaseTelemetryPersistOverride,
  type ChimpbaseTelemetryRecord,
  type ChimpbaseWorkerRegistration,
} from "@chimpbase/core";
import {
  applyInlinePostgresMigrations,
  applyPostgresSqlMigrations,
  createPostgresEngineAdapter,
  ensurePostgresInternalTables,
  openPostgresPool,
} from "@chimpbase/postgres";
import {
  describeWorkflow,
  register as registerEntries,
  registerFrom as registerEntriesFrom,
  type ChimpbaseActionHandler,
  type ChimpbaseCronHandler,
  type ChimpbaseRegistration,
  type ChimpbaseRouteEnv,
  type ChimpbaseRouteHandler,
  type ChimpbaseSubscriptionHandler,
  type ChimpbaseSubscriptionOptions,
  type ChimpbaseWorkerDefinition,
  type ChimpbaseWorkerHandler,
  type ChimpbaseWorkflowContract,
  type ChimpbaseWorkflowDefinition,
} from "@chimpbase/runtime";
import { loadProjectConfig } from "@chimpbase/tooling/config";
import { loadProjectMigrations } from "@chimpbase/tooling/migrations";
import { loadLocalSecretStore } from "@chimpbase/tooling/secrets";
import {
  syncRegisteredWorkflowContracts,
  type WorkflowContractSyncOptions,
  type WorkflowContractSyncResult,
} from "@chimpbase/tooling/workflow_contracts";

import { requireDenoServe, getDenoEnv, getDenoEnvObject, type DenoServeHandle } from "./deno_runtime.ts";
import { loadChimpbaseEntrypoint } from "./entrypoint_loader.ts";
import {
  applyInlineSqlMigrations,
  applySqlMigrations,
  createSqliteEngineAdapter,
  ensureSqliteInternalTables,
  openSqliteDatabase,
} from "./sqlite_adapter.ts";

interface WorkerHandle {
  stop(): void;
}

interface StorageHandle {
  close(): void | Promise<void>;
}

export type TelemetryRecord = ChimpbaseTelemetryRecord;
export type ActionExecutionResult = ChimpbaseActionExecutionResult;
export type CronScheduleExecutionResult = ChimpbaseCronScheduleExecutionResult;
export type QueueExecutionResult = ChimpbaseQueueExecutionResult;
export type RouteExecutionResult = ChimpbaseRouteExecutionResult;
export type DrainOptions = ChimpbaseDrainOptions;
export type DrainResult = ChimpbaseDrainResult;
export type { DenoServeHandle } from "./deno_runtime.ts";

export interface CreateHostOptions {
  config: ChimpbaseProjectConfig;
  entrypointPath?: string;
  migrations?: ChimpbaseMigrationsDefinition;
  migrationSource?: ChimpbaseMigrationSource;
  migrationsDir?: string | null;
  migrationsSql?: string[];
  platform?: ChimpbasePlatformShim;
  projectDir?: string;
  secrets?: ChimpbaseSecretsSource;
}

export class ChimpbaseDenoHost implements ChimpbaseEntrypointTarget {
  readonly config: ChimpbaseProjectConfig;
  readonly engine: ChimpbaseEngine;
  readonly platform: ChimpbasePlatformShim;
  readonly projectDir: string;
  readonly registry: ChimpbaseRegistry;
  private cronRegistryDirty = true;
  private cronSyncPromise: Promise<void> | null = null;
  private readonly storage: StorageHandle;

  private constructor(
    projectDir: string,
    config: ChimpbaseProjectConfig,
    platform: ChimpbasePlatformShim,
    storage: StorageHandle,
    engine: ChimpbaseEngine,
    registry: ChimpbaseRegistry,
  ) {
    this.projectDir = projectDir;
    this.config = config;
    this.platform = platform;
    this.storage = storage;
    this.engine = engine;
    this.registry = registry;
  }

  static async load(projectDirInput: string): Promise<ChimpbaseDenoHost> {
    const projectDir = resolve(projectDirInput);
    const config = await loadProjectConfig(projectDir);
    return await ChimpbaseDenoHost.create({
      config,
      entrypointPath: projectDir,
      migrationsDir: resolve(projectDir, "migrations"),
      projectDir,
    });
  }

  static async create(options: CreateHostOptions): Promise<ChimpbaseDenoHost> {
    const projectDir = resolve(options.projectDir ?? ".");
    const platform = options.platform ?? createDefaultChimpbasePlatformShim();
    const registry = createChimpbaseRegistry();
    const { adapter, storage } = await openStorage(
      projectDir,
      options.config,
      platform,
      listChimpbaseMigrationsForEngine(options.migrations, options.config.storage.engine),
      options.migrationSource ?? createLocalMigrationSource(projectDir, options.config, options.migrationsDir ?? null),
      options.migrationsSql ?? [],
    );
    const secrets = options.secrets ?? await loadLocalSecretStore(projectDir, options.config, {
      env: getDenoEnvObject(),
      envFileDefault: getDenoEnv("CHIMPBASE_ENV_FILE") ?? ".env",
      secretsDirDefault: getDenoEnv("CHIMPBASE_SECRETS_DIR") ?? "/run/secrets",
    });
    const engine = new ChimpbaseEngine({
      adapter,
      platform,
      registry,
      secrets,
      telemetry: {
        minLevel: options.config.telemetry.minLevel,
        persist: options.config.telemetry.persist,
      },
      worker: options.config.worker,
    });
    const host = new ChimpbaseDenoHost(projectDir, options.config, platform, storage, engine, registry);

    if (options.entrypointPath) {
      await loadChimpbaseEntrypoint(options.entrypointPath, host);
    }

    if (options.config.telemetry.retention.enabled) {
      host.registerCron(
        "__chimpbase.telemetry.cleanup",
        options.config.telemetry.retention.schedule,
        async (ctx) => {
          const cutoffMs = platform.now() - options.config.telemetry.retention.maxAgeDays * 86_400_000;
          const cutoffTimestamp = new Date(cutoffMs).toISOString();
          await ctx.query(
            `DELETE FROM _chimpbase_stream_events WHERE stream_name IN ('_chimpbase.logs', '_chimpbase.metrics', '_chimpbase.traces') AND created_at < ?1`,
            [cutoffTimestamp],
          );
        },
      );
      host.setTelemetryOverride("cron:__chimpbase.telemetry.cleanup", false);
    }

    return host;
  }

  async executeAction(name: string, args: unknown[] = []): Promise<ActionExecutionResult> {
    return await this.engine.executeAction(name, args);
  }

  async executeRoute(request: Request): Promise<RouteExecutionResult> {
    return await this.engine.executeRoute(request);
  }

  async processNextQueueJob(): Promise<QueueExecutionResult | null> {
    return await this.engine.processNextQueueJob();
  }

  async processNextCronSchedule(): Promise<CronScheduleExecutionResult | null> {
    await this.syncCronSchedulesIfNeeded();
    return await this.engine.processNextCronSchedule();
  }

  async drain(options: DrainOptions = {}): Promise<DrainResult> {
    await this.syncCronSchedulesIfNeeded();
    return await this.engine.drain(options);
  }

  register(...entriesOrGroups: Array<ChimpbaseRegistration | readonly ChimpbaseRegistration[]>): this {
    registerEntries(this, ...entriesOrGroups);
    return this;
  }

  registerFrom(...sources: object[]): this {
    registerEntriesFrom(this, ...sources);
    return this;
  }

  registerAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ): ChimpbaseActionHandler<TArgs, TResult> {
    this.registry.actions.set(name, handler as ChimpbaseActionHandler);
    return handler;
  }

  registerSubscription<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
    options?: ChimpbaseSubscriptionOptions,
  ): ChimpbaseSubscriptionHandler<TPayload, TResult> {
    const idempotent = options?.idempotent ?? false;
    const subscriptions = this.registry.subscriptions.get(eventName) ?? [];
    subscriptions.push({
      handler: handler as ChimpbaseSubscriptionHandler,
      idempotent,
      name: options?.name ?? "",
    });
    this.registry.subscriptions.set(eventName, subscriptions);
    return handler;
  }

  registerWorker<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseWorkerHandler<TPayload, TResult>,
    definition?: ChimpbaseWorkerDefinition,
  ): ChimpbaseWorkerHandler<TPayload, TResult> {
    const registration: ChimpbaseWorkerRegistration = {
      definition: {
        dlq: definition?.dlq === undefined ? `${name}.dlq` : definition.dlq,
      },
      handler: handler as ChimpbaseWorkerHandler,
      name,
    };
    this.registry.workers.set(name, registration);
    return handler;
  }

  registerCron<TResult = unknown>(
    name: string,
    schedule: string,
    handler: ChimpbaseCronHandler<TResult>,
  ): ChimpbaseCronHandler<TResult> {
    this.registry.crons.set(name, {
      handler: handler as ChimpbaseCronHandler,
      name,
      schedule,
    });
    this.cronRegistryDirty = true;
    return handler;
  }

  registerWorkflow<TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ): ChimpbaseWorkflowDefinition<TInput, TState> {
    const versions = this.registry.workflows.get(definition.name) ?? new Map();
    versions.set(definition.version, definition as ChimpbaseWorkflowDefinition);
    this.registry.workflows.set(definition.name, versions);
    return definition;
  }

  setHttpHandler(handler: ChimpbaseRouteHandler | null): void {
    this.registry.httpHandler = handler;
  }

  setTelemetryOverride(key: string, value: ChimpbaseTelemetryPersistOverride): void {
    this.registry.telemetryOverrides.set(key, value);
  }

  routeEnv(): ChimpbaseRouteEnv {
    return this.engine.createRouteEnv();
  }

  listWorkflowContracts(): ChimpbaseWorkflowContract[] {
    return [...this.registry.workflows.entries()]
      .flatMap(([, versions]) => [...versions.values()].map((definition) => describeWorkflow(definition)))
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name);
        if (byName !== 0) {
          return byName;
        }

        return left.version - right.version;
      });
  }

  async syncWorkflowContracts(
    options: WorkflowContractSyncOptions = {},
  ): Promise<WorkflowContractSyncResult> {
    return await syncRegisteredWorkflowContracts(this.registry, this.projectDir, {
      ...options,
      contractsDir: options.contractsDir ?? this.config.workflows.contractsDir,
    });
  }

  async syncCronSchedules(): Promise<void> {
    this.cronRegistryDirty = true;
    await this.syncCronSchedulesIfNeeded();
  }

  serve(): DenoServeHandle {
    const serve = requireDenoServe();
    const server = serve(
      { port: this.config.server.port },
      async (request) => {
        if (new URL(request.url).pathname === "/health") {
          return Response.json({ ok: true });
        }

        const outcome = await this.executeRoute(request);
        if (!outcome.response) {
          return new Response("route handler not found", { status: 404 });
        }

        if (outcome.emittedEvents.length > 0) {
          console.log(
            `handled ${request.method} ${new URL(request.url).pathname} with ${outcome.emittedEvents.length} emitted event(s)`,
          );
        }

        return outcome.response;
      },
    );

    return {
      ...server,
      port: this.config.server.port,
    };
  }

  start(options: { runWorker?: boolean; serve?: boolean } = {}) {
    const runServe = options.serve ?? !options.runWorker;
    const runWorker = options.runWorker ?? !options.serve;
    const worker = runWorker ? this.startWorker() : null;
    const server = runServe ? this.serve() : null;

    return {
      host: this,
      server,
      async stop() {
        server?.shutdown?.();
        worker?.stop();
        await server?.finished;
      },
    };
  }

  startWorker(): WorkerHandle {
    let running = false;
    let stopped = false;

    const tick = async () => {
      if (running || stopped) {
        return;
      }

      running = true;
      try {
        while (!stopped) {
          const outcome = await this.drain({ maxRuns: 1 });
          if (outcome.idle) {
            break;
          }
        }
      } catch (error) {
        console.error("[@chimpbase/deno][worker]", error);
      } finally {
        running = false;
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, this.config.worker.pollIntervalMs);

    return {
      stop() {
        stopped = true;
        clearInterval(interval);
      },
    };
  }

  drainTelemetryRecords(): TelemetryRecord[] {
    return this.engine.drainTelemetryRecords();
  }

  close(): void {
    void this.storage.close();
  }

  private async syncCronSchedulesIfNeeded(): Promise<void> {
    if (!this.cronRegistryDirty) {
      return;
    }

    if (this.cronSyncPromise) {
      await this.cronSyncPromise;
      return;
    }

    this.cronSyncPromise = (async () => {
      while (this.cronRegistryDirty) {
        this.cronRegistryDirty = false;

        try {
          await this.engine.syncRegisteredCrons();
        } catch (error) {
          this.cronRegistryDirty = true;
          throw error;
        }
      }
    })();

    try {
      await this.cronSyncPromise;
    } finally {
      this.cronSyncPromise = null;
    }
  }
}

async function openStorage(
  projectDir: string,
  config: ChimpbaseProjectConfig,
  platform: ChimpbasePlatformShim,
  inlineMigrations: readonly ChimpbaseMigration[],
  migrationSource: ChimpbaseMigrationSource,
  migrationsSql: string[],
): Promise<{ adapter: ChimpbaseEngineAdapter; storage: StorageHandle }> {
  const resolvedMigrations = [
    ...await migrationSource.list(),
    ...inlineMigrations,
  ];

  if (config.storage.engine === "postgres") {
    if (!config.storage.url) {
      throw new Error("@chimpbase/deno requires storage.url for postgres storage");
    }

    const pool = openPostgresPool(config);
    await applyPostgresSqlMigrations(pool, resolvedMigrations.map((migration) => migration.sql));
    await applyInlinePostgresMigrations(pool, migrationsSql);
    await ensurePostgresInternalTables(pool);

    return {
      adapter: createPostgresEngineAdapter(pool, platform),
      storage: {
        close() {
          return pool.end();
        },
      },
    };
  }

  const db = await openSqliteDatabase(projectDir, config);
  await applySqlMigrations(db, resolvedMigrations.map((migration) => migration.sql));
  await applyInlineSqlMigrations(db, migrationsSql);
  await ensureSqliteInternalTables(db);

  return {
    adapter: createSqliteEngineAdapter(db, platform),
    storage: {
      close() {
        db.close();
      },
    },
  };
}

function createLocalMigrationSource(
  projectDir: string,
  config: ChimpbaseProjectConfig,
  migrationsDir: string | null,
): ChimpbaseMigrationSource {
  return {
    async list(): Promise<ChimpbaseMigration[]> {
      return await loadProjectMigrations(projectDir, config.storage.engine, { migrationsDir });
    },
  };
}
