import { resolve } from "node:path";

import {
  ChimpbaseEngine,
  type ChimpbaseEntrypointTarget,
  type ChimpbaseEngineAdapter,
  createChimpbaseRegistry,
  loadChimpbaseEntrypoint,
  type ChimpbaseActionExecutionResult,
  type ChimpbaseProjectConfig,
  type ChimpbaseQueueRegistration,
  type ChimpbaseRegistry,
  type ChimpbaseQueueExecutionResult,
  type ChimpbaseRouteExecutionResult,
  type ChimpbaseTelemetryRecord,
} from "@chimpbase/core";
import type {
  ChimpbaseActionHandler,
  ChimpbaseListenerHandler,
  ChimpbaseQueueDefinition,
  ChimpbaseQueueHandler,
  ChimpbaseRouteEnv,
  ChimpbaseRouteHandler,
} from "@chimpbase/runtime";

import {
  loadProjectConfig,
} from "./config.ts";
import {
  applyInlinePostgresMigrations,
  applyPostgresSqlMigrations,
  createPostgresEngineAdapter,
  ensurePostgresInternalTables,
  openPostgresPool,
} from "./postgres_adapter.ts";
import {
  applyInlineSqlMigrations,
  applySqlMigrations,
  createSqliteEngineAdapter,
  ensureSqliteInternalTables,
  openSqliteDatabase,
} from "./sqlite_adapter.ts";

interface RouteRequestLike {
  headers: Headers;
  method: string;
  url: string;
}

interface WorkerHandle {
  stop(): void;
}

interface StorageHandle {
  close(): void | Promise<void>;
}

export type TelemetryRecord = ChimpbaseTelemetryRecord;
export type ActionExecutionResult = ChimpbaseActionExecutionResult;
export type QueueExecutionResult = ChimpbaseQueueExecutionResult;
export type RouteExecutionResult = ChimpbaseRouteExecutionResult;

interface CreateHostOptions {
  config: ChimpbaseProjectConfig;
  entrypointPath?: string;
  migrationsDir?: string | null;
  migrationsSql?: string[];
  projectDir?: string;
}

export class ChimpbaseBunHost implements ChimpbaseEntrypointTarget {
  readonly config: ChimpbaseProjectConfig;
  readonly engine: ChimpbaseEngine;
  readonly projectDir: string;
  readonly registry: ChimpbaseRegistry;
  private readonly storage: StorageHandle;

  private constructor(
    projectDir: string,
    config: ChimpbaseProjectConfig,
    storage: StorageHandle,
    engine: ChimpbaseEngine,
    registry: ChimpbaseRegistry,
  ) {
    this.projectDir = projectDir;
    this.config = config;
    this.storage = storage;
    this.engine = engine;
    this.registry = registry;
  }

  static async load(projectDirInput: string): Promise<ChimpbaseBunHost> {
    const projectDir = resolve(projectDirInput);
    const config = await loadProjectConfig(projectDir);
    return await ChimpbaseBunHost.create({
      config,
      entrypointPath: projectDir,
      migrationsDir: resolve(projectDir, "migrations"),
      projectDir,
    });
  }

  static async create(options: CreateHostOptions): Promise<ChimpbaseBunHost> {
    const projectDir = resolve(options.projectDir ?? ".");
    const registry = createChimpbaseRegistry();
    const { adapter, storage } = await openStorage(projectDir, options.config, options.migrationsDir ?? null, options.migrationsSql ?? []);
    const engine = new ChimpbaseEngine({
      adapter,
      registry,
      worker: options.config.worker,
    });
    const host = new ChimpbaseBunHost(projectDir, options.config, storage, engine, registry);

    if (options.entrypointPath) {
      await loadChimpbaseEntrypoint(options.entrypointPath, host);
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

  registerAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ): ChimpbaseActionHandler<TArgs, TResult> {
    this.registry.actions.set(name, handler as ChimpbaseActionHandler);
    return handler;
  }

  registerListener<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseListenerHandler<TPayload, TResult>,
  ): ChimpbaseListenerHandler<TPayload, TResult> {
    const listeners = this.registry.listeners.get(eventName) ?? [];
    listeners.push(handler as ChimpbaseListenerHandler);
    this.registry.listeners.set(eventName, listeners);
    return handler;
  }

  registerQueue<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseQueueHandler<TPayload, TResult>,
    definition?: ChimpbaseQueueDefinition,
  ): ChimpbaseQueueHandler<TPayload, TResult> {
    const registration: ChimpbaseQueueRegistration = {
      definition: {
        dlq: definition?.dlq === undefined ? `${name}.dlq` : definition.dlq,
      },
      handler: handler as ChimpbaseQueueHandler,
      name,
    };
    this.registry.queues.set(name, registration);
    return handler;
  }

  setHttpHandler(handler: ChimpbaseRouteHandler | null): void {
    this.registry.httpHandler = handler;
  }

  routeEnv(): ChimpbaseRouteEnv {
    return this.engine.createRouteEnv();
  }

  serve() {
    return Bun.serve({
      fetch: async (request) => {
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
      port: this.config.server.port,
    });
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
        server?.stop(true);
        worker?.stop();
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
          const job = await this.processNextQueueJob();
          if (!job) {
            break;
          }
        }
      } catch (error) {
        console.error("[chimpbase-bun][worker]", error);
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
}

export function getRouteKey(request: RouteRequestLike): string {
  return `${request.method.toUpperCase()} ${new URL(request.url).pathname}`;
}

async function openStorage(
  projectDir: string,
  config: ChimpbaseProjectConfig,
  migrationsDir: string | null,
  migrationsSql: string[],
): Promise<{ adapter: ChimpbaseEngineAdapter; storage: StorageHandle }> {
  if (config.storage.engine === "postgres") {
    const pool = openPostgresPool(config);
    await applyPostgresSqlMigrations(pool, migrationsDir);
    await applyInlinePostgresMigrations(pool, migrationsSql);
    await ensurePostgresInternalTables(pool);
    return {
      adapter: createPostgresEngineAdapter(pool),
      storage: {
        close() {
          return pool.end();
        },
      },
    };
  }

  const db = await openSqliteDatabase(projectDir, config);
  await applySqlMigrations(db, migrationsDir);
  await applyInlineSqlMigrations(db, migrationsSql);
  await ensureSqliteInternalTables(db);
  return {
    adapter: createSqliteEngineAdapter(db),
    storage: {
      close() {
        db.close();
      },
    },
  };
}
