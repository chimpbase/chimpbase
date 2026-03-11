import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  ChimpbaseEngine,
  type ChimpbaseEntrypointTarget,
  type ChimpbaseEngineAdapter,
  createChimpbaseRegistry,
  loadChimpbaseEntrypoint,
  type ChimpbaseActionExecutionResult,
  type ChimpbaseProjectConfig,
  type ChimpbaseRegistry,
  type ChimpbaseQueueExecutionResult,
  type ChimpbaseRouteExecutionResult,
  type ChimpbaseTelemetryRecord,
  type ChimpbaseWorkerRegistration,
} from "@chimpbase/core";
import {
  describeWorkflow,
  register as registerEntries,
  registerFrom as registerEntriesFrom,
  type ChimpbaseActionHandler,
  type ChimpbaseRegistration,
  type ChimpbaseRouteEnv,
  type ChimpbaseRouteHandler,
  type ChimpbaseSubscriptionHandler,
  type ChimpbaseWorkerDefinition,
  type ChimpbaseWorkerHandler,
  type ChimpbaseWorkflowContract,
  type ChimpbaseWorkflowDefinition,
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
import {
  syncRegisteredWorkflowContracts,
  type WorkflowContractSyncOptions,
  type WorkflowContractSyncResult,
} from "./workflow_contracts.ts";

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

interface SecretStore {
  get(name: string): string | null;
}

export type TelemetryRecord = ChimpbaseTelemetryRecord;
export type ActionExecutionResult = ChimpbaseActionExecutionResult;
export type QueueExecutionResult = ChimpbaseQueueExecutionResult;
export type RouteExecutionResult = ChimpbaseRouteExecutionResult;

const DEFAULT_SECRETS_DIR = "/run/secrets";
const DEFAULT_ENV_FILE = ".env";

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
    const secrets = await loadSecretStore(projectDir, options.config);
    const engine = new ChimpbaseEngine({
      adapter,
      registry,
      secrets,
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
  ): ChimpbaseSubscriptionHandler<TPayload, TResult> {
    const subscriptions = this.registry.subscriptions.get(eventName) ?? [];
    subscriptions.push(handler as ChimpbaseSubscriptionHandler);
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
        console.error("[@chimpbase/bun][worker]", error);
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
  const resolvedMigrationsDir = await resolveMigrationsDir(
    migrationsDir,
    config.storage.engine,
  );

  if (config.storage.engine === "postgres") {
    const pool = openPostgresPool(config);
    await applyPostgresSqlMigrations(pool, resolvedMigrationsDir);
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
  await applySqlMigrations(db, resolvedMigrationsDir);
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

async function resolveMigrationsDir(
  migrationsDir: string | null,
  engine: ChimpbaseProjectConfig["storage"]["engine"],
): Promise<string | null> {
  if (!migrationsDir) {
    return null;
  }

  const engineDir = resolve(migrationsDir, engine);
  return await directoryHasSqlFiles(engineDir) ? engineDir : migrationsDir;
}

async function directoryHasSqlFiles(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.some((entry) => entry.endsWith(".sql"));
  } catch {
    return false;
  }
}

async function loadSecretStore(
  projectDir: string,
  config: ChimpbaseProjectConfig,
): Promise<SecretStore> {
  const values = new Map<string, string>();

  const envFilePath = resolveSecretPath(
    projectDir,
    config.secrets.envFile ?? Bun.env.CHIMPBASE_ENV_FILE ?? DEFAULT_ENV_FILE,
  );
  if (envFilePath) {
    await preloadDotenvFile(envFilePath, values);
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      values.set(name, value);
    }
  }

  const secretsDirPath = resolveSecretPath(
    projectDir,
    config.secrets.dir ?? Bun.env.CHIMPBASE_SECRETS_DIR ?? DEFAULT_SECRETS_DIR,
  );
  if (secretsDirPath) {
    await preloadSecretDirectory(secretsDirPath, values);
  }

  return {
    get(name: string): string | null {
      return values.get(name) ?? null;
    },
  };
}

async function preloadDotenvFile(path: string, values: Map<string, string>): Promise<void> {
  let raw: string;
  try {
    raw = await Bun.file(path).text();
  } catch {
    return;
  }

  for (const [name, value] of parseDotenv(raw)) {
    values.set(name, value);
  }
}

async function preloadSecretDirectory(path: string, values: Map<string, string>): Promise<void> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    values.set(entry.name, await Bun.file(resolve(path, entry.name)).text());
  }
}

function resolveSecretPath(projectDir: string, path: string | null): string | null {
  if (!path) {
    return null;
  }

  return isAbsolute(path) ? path : resolve(projectDir, path);
}

function parseDotenv(raw: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const name = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1);
    values.set(name, parseDotenvValue(rawValue));
  }

  return values;
}

function parseDotenvValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const firstCharacter = trimmed[0];
  const isQuoted = (firstCharacter === '"' || firstCharacter === "'") && trimmed.endsWith(firstCharacter);
  if (isQuoted) {
    const inner = trimmed.slice(1, -1);
    if (firstCharacter === '"') {
      return inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    return inner;
  }

  return trimmed.replace(/\s+#.*$/, "");
}
