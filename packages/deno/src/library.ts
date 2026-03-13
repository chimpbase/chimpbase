import { join, resolve } from "node:path";

import {
  defineChimpbaseApp,
  normalizeProjectConfig,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
  type ChimpbaseSecretsSource,
} from "@chimpbase/core";
import { loadProjectAppDefinition } from "@chimpbase/tooling/app";
import { runChimpbaseCli } from "@chimpbase/tooling/cli";
import { syncChimpbaseSchemaArtifacts, type ChimpbaseSchemaSyncOptions, type ChimpbaseSchemaSyncResult } from "@chimpbase/tooling/schema";
import type { WorkflowContractSyncOptions, WorkflowContractSyncResult } from "@chimpbase/tooling/workflow_contracts";

import { getDenoArgs, getDenoEnv } from "./deno_runtime.ts";
import { ChimpbaseDenoHost, type ActionExecutionResult, type CreateHostOptions, type DenoServeHandle } from "./runtime.ts";

interface WorkerHandle {
  stop(): void;
}

export interface StartChimpbaseProjectOptions {
  projectDir?: string;
  runWorker?: boolean;
  serve?: boolean;
}

export interface StartedChimpbaseProject {
  host: ChimpbaseDenoHost;
  server: DenoServeHandle | null;
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
    dispatch?: "async" | "sync";
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
    concurrency?: number;
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

export async function loadChimpbaseProject(projectDir = "."): Promise<ChimpbaseDenoHost> {
  const resolvedProjectDir = resolve(projectDir);
  const app = await loadProjectAppDefinitionOrThrow(resolvedProjectDir);
  return await loadChimpbaseApp(app, { projectDir: resolvedProjectDir });
}

export async function loadChimpbaseApp(
  app: ChimpbaseAppDefinition,
  options: LoadChimpbaseAppOptions = {},
): Promise<ChimpbaseDenoHost> {
  return await createChimpbaseDenoImpl({
    ...options,
    app,
  });
}

async function createChimpbaseDenoImpl(
  options: CreateChimpbaseOptions,
): Promise<ChimpbaseDenoHost> {
  return await createChimpbaseDenoFromApp(normalizeCreateChimpbaseOptions(options));
}

async function createChimpbaseDenoFrom(
  projectDir: string,
  options: CreateChimpbaseWithDefaultsOptions = {},
): Promise<ChimpbaseDenoHost> {
  const resolvedProjectDir = resolve(projectDir);
  const app = await loadProjectAppDefinitionOrThrow(resolvedProjectDir);
  return await createChimpbaseDenoImpl({
    app,
    ...options,
    projectDir: resolvedProjectDir,
  });
}

export const createChimpbaseDeno = Object.assign(createChimpbaseDenoImpl, {
  from: createChimpbaseDenoFrom,
});

export async function runChimpbaseAction(
  actionName: string,
  args: unknown[] | unknown = [],
  options: { projectDir?: string } = {},
): Promise<{ host: ChimpbaseDenoHost; outcome: ActionExecutionResult }> {
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
): Promise<{ host: ChimpbaseDenoHost; result: WorkflowContractSyncResult }> {
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
): Promise<{ host: ChimpbaseDenoHost; outcome: ActionExecutionResult }> {
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
  type CreateHostOptions,
};

export async function runDenoCli(argv = getDenoArgs()): Promise<void> {
  await runChimpbaseCli(argv, {
    runAction: runChimpbaseAction,
    startProject: startChimpbaseProject,
    syncSchema: syncChimpbaseSchema,
    syncWorkflowContracts: syncChimpbaseWorkflowContracts,
  });
}

async function createChimpbaseDenoFromApp(
  options: CreateChimpbaseFromAppOptions,
): Promise<ChimpbaseDenoHost> {
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
          ?? getDenoEnv("CHIMPBASE_STORAGE_PATH")
          ?? join("data", `${options.app.project.name}.db`),
      url: options.storage?.url
        ?? getDenoEnv("CHIMPBASE_DATABASE_URL")
        ?? getDenoEnv("DATABASE_URL")
        ?? null,
    },
    subscriptions: {
      dispatch: options.subscriptions?.dispatch ?? inferSubscriptionDispatchMode(),
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
      concurrency: options.workerRuntime?.concurrency ?? inferNumberEnv("CHIMPBASE_WORKER_CONCURRENCY"),
      leaseMs: options.workerRuntime?.leaseMs ?? inferNumberEnv("CHIMPBASE_WORKER_LEASE_MS"),
      maxAttempts: options.app.worker.maxAttempts,
      pollIntervalMs: options.workerRuntime?.pollIntervalMs ?? inferNumberEnv("CHIMPBASE_WORKER_POLL_INTERVAL_MS"),
      retryDelayMs: options.app.worker.retryDelayMs,
    },
    workflows: {
      contractsDir: options.app.workflows.contractsDir ?? undefined,
    },
  });

  const host = await ChimpbaseDenoHost.create({
    app: options.app,
    config,
    debug: inferDebugEnabled(options.debug),
    migrationsDir: inferMigrationsDir(projectDir, options.migrationsDir ?? getDenoEnv("CHIMPBASE_MIGRATIONS_DIR"), options),
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
  const value = getDenoEnv("CHIMPBASE_SERVER_PORT") ?? getDenoEnv("PORT");
  const port = value ? Number(value) : NaN;
  return Number.isFinite(port) ? port : 3000;
}

function inferStorageEngine(options: Pick<CreateChimpbaseFromAppOptions, "storage">): "memory" | "postgres" | "sqlite" {
  if (options.storage?.engine) {
    return options.storage.engine;
  }

  const envEngine = getDenoEnv("CHIMPBASE_STORAGE_ENGINE");
  if (envEngine === "memory") {
    return "memory";
  }

  if (envEngine === "postgres" || options.storage?.url || getDenoEnv("CHIMPBASE_DATABASE_URL") || getDenoEnv("DATABASE_URL")) {
    return "postgres";
  }

  if (envEngine === "sqlite") {
    return envEngine;
  }

  return "sqlite";
}

function inferSubscriptionDispatchMode(): "async" | "sync" | undefined {
  const value = getDenoEnv("CHIMPBASE_SUBSCRIPTION_DISPATCH_MODE");
  return value === "async" || value === "sync" ? value : undefined;
}

function inferNumberEnv(name: string): number | undefined {
  const value = getDenoEnv(name);
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

  return isTruthyEnv(getDenoEnv("CHIMPBASE_DEBUG"));
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
  host: ChimpbaseDenoHost,
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
