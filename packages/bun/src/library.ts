import { join, resolve } from "node:path";

import {
  defineChimpbaseApp,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
  normalizeProjectConfig,
  type ChimpbaseSecretsSource,
} from "@chimpbase/core";
import {
  loadProjectAppDefinition,
} from "@chimpbase/tooling/app";
import type {
  ChimpbaseSchemaSyncOptions,
  ChimpbaseSchemaSyncResult,
} from "@chimpbase/tooling/schema";
import {
  syncChimpbaseSchemaArtifacts,
} from "@chimpbase/tooling/schema";
import type {
  WorkflowContractSyncOptions,
  WorkflowContractSyncResult,
} from "@chimpbase/tooling/workflow_contracts";
import {
  ChimpbaseBunHost,
  type ActionExecutionResult,
} from "./runtime.ts";

interface WorkerHandle {
  stop(): void;
}

export interface StartChimpbaseProjectOptions {
  projectDir?: string;
  runWorker?: boolean;
  serve?: boolean;
}

export interface StartedChimpbaseProject {
  host: ChimpbaseBunHost;
  server: Bun.Server<unknown> | null;
  stop(): Promise<void>;
}

interface CreateChimpbaseRuntimeOptions {
  debug?: boolean;
  migrationsDir?: string;
  migrationsSql?: string[];
  projectDir?: string;
  secrets?: ChimpbaseSecretsSource;
  server?: {
    port?: number;
  };
  storage?: {
    engine?: "memory" | "postgres" | "sqlite";
    path?: string | null;
    url?: string | null;
  };
  subscriptions?: {
    idempotency?: {
      retention?: {
        enabled?: boolean;
        maxAgeDays?: number;
        schedule?: string;
      };
    };
  };
  telemetryRetention?: {
    enabled?: boolean;
    maxAgeDays?: number;
    schedule?: string;
  };
  workerRuntime?: {
    leaseMs?: number;
    pollIntervalMs?: number;
  };
}

export interface CreateChimpbaseFromAppOptions extends CreateChimpbaseRuntimeOptions {
  app: ChimpbaseAppDefinition;
}

export interface CreateChimpbaseAppFieldsOptions extends CreateChimpbaseRuntimeOptions, ChimpbaseAppDefinitionInput {}

export type CreateChimpbaseOptions = CreateChimpbaseAppFieldsOptions | CreateChimpbaseFromAppOptions;
export type CreateChimpbaseWithDefaultsOptions = Omit<CreateChimpbaseRuntimeOptions, "projectDir">;
export type LoadChimpbaseAppOptions = CreateChimpbaseRuntimeOptions;

export interface SyncChimpbaseWorkflowContractsOptions extends WorkflowContractSyncOptions {
  projectDir?: string;
}

export interface SyncChimpbaseSchemaOptions extends ChimpbaseSchemaSyncOptions {
  projectDir?: string;
}

export async function loadChimpbaseProject(projectDir = "."): Promise<ChimpbaseBunHost> {
  const resolvedProjectDir = resolve(projectDir);
  const app = await loadProjectAppDefinitionOrThrow(resolvedProjectDir);
  return await loadChimpbaseApp(app, { projectDir: resolvedProjectDir });
}

export async function loadChimpbaseApp(
  app: ChimpbaseAppDefinition,
  options: LoadChimpbaseAppOptions = {},
): Promise<ChimpbaseBunHost> {
  return await createChimpbaseImpl({
    ...options,
    app,
  });
}

async function createChimpbaseImpl(
  options: CreateChimpbaseOptions,
): Promise<ChimpbaseBunHost> {
  return await createChimpbaseFromApp(normalizeCreateChimpbaseOptions(options));
}

async function createChimpbaseFrom(
  projectDir: string,
  options: CreateChimpbaseWithDefaultsOptions = {},
): Promise<ChimpbaseBunHost> {
  const resolvedProjectDir = resolve(projectDir);
  const app = await loadProjectAppDefinitionOrThrow(resolvedProjectDir);
  return await createChimpbaseImpl({
    app,
    ...options,
    projectDir: resolvedProjectDir,
  });
}

export const createChimpbase = Object.assign(createChimpbaseImpl, {
  from: createChimpbaseFrom,
});

export async function runChimpbaseAction(
  actionName: string,
  args: unknown[] | unknown = [],
  options: { projectDir?: string } = {},
): Promise<{ host: ChimpbaseBunHost; outcome: ActionExecutionResult }> {
  const host = await loadChimpbaseProject(options.projectDir);

  try {
    const outcome = await host.executeAction(actionName, args);
    return { host, outcome };
  } catch (error) {
    host.close();
    throw error;
  }
}

export async function startChimpbaseProject(
  options: StartChimpbaseProjectOptions = {},
): Promise<StartedChimpbaseProject> {
  const host = await loadChimpbaseProject(options.projectDir);
  return startLoadedHost(host, options.serve, options.runWorker);
}

export async function syncChimpbaseWorkflowContracts(
  options: SyncChimpbaseWorkflowContractsOptions = {},
): Promise<{ host: ChimpbaseBunHost; result: WorkflowContractSyncResult }> {
  const host = await loadChimpbaseProject(options.projectDir);

  try {
    const result = await host.syncWorkflowContracts(options);
    return { host, result };
  } catch (error) {
    host.close();
    throw error;
  }
}

export async function syncChimpbaseSchema(
  options: SyncChimpbaseSchemaOptions = {},
): Promise<ChimpbaseSchemaSyncResult> {
  return await syncChimpbaseSchemaArtifacts(options.projectDir ?? ".", options);
}

export async function startChimpbaseApp(
  options: CreateChimpbaseFromAppOptions & Pick<StartChimpbaseProjectOptions, "serve" | "runWorker">,
): Promise<StartedChimpbaseProject> {
  const host = await loadChimpbaseApp(options.app, options);
  return startLoadedHost(host, options.serve, options.runWorker);
}

export async function runChimpbaseAppAction(
  app: ChimpbaseAppDefinition,
  actionName: string,
  args: unknown[] | unknown = [],
  options: LoadChimpbaseAppOptions = {},
): Promise<{ host: ChimpbaseBunHost; outcome: ActionExecutionResult }> {
  const host = await loadChimpbaseApp(app, options);

  try {
    const outcome = await host.executeAction(actionName, args);
    return { host, outcome };
  } catch (error) {
    host.close();
    throw error;
  }
}

export {
  defineChimpbaseApp,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
};

async function createChimpbaseFromApp(
  options: CreateChimpbaseFromAppOptions,
): Promise<ChimpbaseBunHost> {
  const projectDir = resolve(options.projectDir ?? ".");
  const storageEngine = inferStorageEngine(options);
  const config = normalizeProjectConfig({
    project: {
      name: options.app.project.name,
    },
    server: {
      port: options.server?.port ?? inferServerPort(),
    },
    storage: {
      engine: storageEngine,
      path: storageEngine === "memory" || storageEngine === "postgres"
        ? null
        : options.storage?.path
          ?? Bun.env.CHIMPBASE_STORAGE_PATH
          ?? join("data", `${options.app.project.name}.db`),
      url: options.storage?.url
        ?? Bun.env.CHIMPBASE_DATABASE_URL
        ?? Bun.env.DATABASE_URL
        ?? null,
    },
    subscriptions: {
      idempotency: {
        retention: options.subscriptions?.idempotency?.retention,
      },
    },
    telemetry: {
      minLevel: options.app.telemetry.minLevel,
      persist: options.app.telemetry.persist,
      retention: options.telemetryRetention,
    },
    worker: {
      leaseMs: options.workerRuntime?.leaseMs ?? inferNumberEnv("CHIMPBASE_WORKER_LEASE_MS"),
      maxAttempts: options.app.worker.maxAttempts,
      pollIntervalMs: options.workerRuntime?.pollIntervalMs ?? inferNumberEnv("CHIMPBASE_WORKER_POLL_INTERVAL_MS"),
      retryDelayMs: options.app.worker.retryDelayMs,
    },
    workflows: {
      contractsDir: options.app.workflows.contractsDir ?? undefined,
    },
  });
  const host = await ChimpbaseBunHost.create({
    app: options.app,
    config,
    debug: inferDebugEnabled(options.debug),
    migrationsDir: inferMigrationsDir(projectDir, options.migrationsDir ?? Bun.env.CHIMPBASE_MIGRATIONS_DIR, options),
    migrationsSql: options.migrationsSql,
    projectDir,
    secrets: options.secrets,
  });

  return host;
}

function normalizeCreateChimpbaseOptions(
  options: CreateChimpbaseOptions,
): CreateChimpbaseFromAppOptions {
  if ("app" in options && options.app !== undefined) {
    return options as CreateChimpbaseFromAppOptions;
  }

  const {
    httpHandler,
    migrations,
    project,
    registrations,
    telemetry,
    worker,
    workflows,
    ...runtimeOptions
  } = options as CreateChimpbaseAppFieldsOptions;

  return {
    ...runtimeOptions,
    app: defineChimpbaseApp({
      httpHandler,
      migrations,
      project,
      registrations,
      telemetry,
      worker,
      workflows,
    }),
  };
}

function inferServerPort(): number {
  const value = Bun.env.CHIMPBASE_SERVER_PORT ?? Bun.env.PORT;
  const port = value ? Number(value) : NaN;
  return Number.isFinite(port) ? port : 3000;
}

function inferStorageEngine(options: Pick<CreateChimpbaseFromAppOptions, "storage">): "memory" | "postgres" | "sqlite" {
  if (options.storage?.engine) {
    return options.storage.engine;
  }

  if (Bun.env.CHIMPBASE_STORAGE_ENGINE === "memory") {
    return "memory";
  }

  if (Bun.env.CHIMPBASE_STORAGE_ENGINE === "postgres" || options.storage?.url || Bun.env.CHIMPBASE_DATABASE_URL || Bun.env.DATABASE_URL) {
    return "postgres";
  }

  return "sqlite";
}

function inferNumberEnv(name: string): number | undefined {
  const value = Bun.env[name];
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferDebugEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) {
    return explicit;
  }

  return isTruthyEnv(Bun.env.CHIMPBASE_DEBUG);
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value === "1"
    || value === "true"
    || value === "yes"
    || value === "on";
}

function inferMigrationsDir(
  projectDir: string,
  configuredDir: string | undefined,
  options: Pick<CreateChimpbaseFromAppOptions, "migrationsSql">,
): string | null {
  if (configuredDir) {
    return resolve(projectDir, configuredDir);
  }

  if (options.migrationsSql !== undefined) {
    return null;
  }

  return null;
}

async function loadProjectAppDefinitionOrThrow(projectDir: string): Promise<ChimpbaseAppDefinition> {
  const app = await loadProjectAppDefinition(projectDir);
  if (!app) {
    throw new Error(`missing chimpbase.app.ts in ${projectDir}`);
  }

  return app;
}

function startLoadedHost(
  host: ChimpbaseBunHost,
  serveOption?: boolean,
  runWorkerOption?: boolean,
): StartedChimpbaseProject {
  const started = host.start({
    runWorker: runWorkerOption,
    serve: serveOption,
  });

  return {
    host,
    server: started.server,
    async stop() {
      await started.stop();
      host.close();
    },
  };
}
