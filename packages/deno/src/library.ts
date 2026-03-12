import { basename, join, resolve } from "node:path";

import {
  defineChimpbaseApp,
  defineChimpbaseMigrations,
  normalizeProjectConfig,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
  type ChimpbaseMigrationsDefinitionInput,
  type ChimpbaseProjectConfigInput,
  type ChimpbaseSecretsSource,
} from "@chimpbase/core";
import type { ChimpbaseRouteHandler } from "@chimpbase/runtime";
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

export interface CreateChimpbaseFromAppOptions {
  app: ChimpbaseAppDefinition;
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

export interface CreateChimpbaseLegacyOptions extends ChimpbaseProjectConfigInput {
  httpHandler?: ChimpbaseRouteHandler | { fetch: ChimpbaseRouteHandler };
  migrations?: ChimpbaseMigrationsDefinitionInput;
  migrationsDir?: string;
  migrationsSql?: string[];
  modules?: object[];
  projectDir?: string;
}

export type CreateChimpbaseOptions = CreateChimpbaseFromAppOptions | CreateChimpbaseLegacyOptions;
type CreateChimpbaseFromAppWithDefaultsOptions = Omit<CreateChimpbaseFromAppOptions, "projectDir">;
type CreateChimpbaseLegacyWithDefaultsOptions = Omit<CreateChimpbaseLegacyOptions, "projectDir">;
export type CreateChimpbaseWithDefaultsOptions =
  | CreateChimpbaseFromAppWithDefaultsOptions
  | CreateChimpbaseLegacyWithDefaultsOptions;
export type LoadChimpbaseAppOptions = Omit<CreateChimpbaseFromAppOptions, "app">;

export interface SyncChimpbaseWorkflowContractsOptions extends WorkflowContractSyncOptions {
  projectDir?: string;
}

export interface SyncChimpbaseSchemaOptions extends ChimpbaseSchemaSyncOptions {
  projectDir?: string;
}

export async function loadChimpbaseProject(projectDir = "."): Promise<ChimpbaseDenoHost> {
  const resolvedProjectDir = resolve(projectDir);
  const app = await loadProjectAppDefinition(resolvedProjectDir);
  if (app) {
    return await loadChimpbaseApp(app, { projectDir: resolvedProjectDir });
  }

  return await ChimpbaseDenoHost.load(resolvedProjectDir);
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
  options: CreateChimpbaseOptions = {},
): Promise<ChimpbaseDenoHost> {
  if (isCreateChimpbaseFromAppOptions(options)) {
    return await createChimpbaseDenoFromApp(options);
  }

  const projectDir = resolve(options.projectDir ?? ".");
  const storageEngine = inferStorageEngine(options);
  const config = normalizeProjectConfig({
    ...options,
    project: {
      name: options.project?.name ?? inferProjectName(projectDir),
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
          ?? join("data", `${inferProjectName(projectDir)}.db`),
      url: options.storage?.url
        ?? getDenoEnv("CHIMPBASE_DATABASE_URL")
        ?? getDenoEnv("DATABASE_URL")
        ?? null,
    },
    worker: {
      leaseMs: options.worker?.leaseMs ?? inferNumberEnv("CHIMPBASE_WORKER_LEASE_MS"),
      maxAttempts: options.worker?.maxAttempts ?? inferNumberEnv("CHIMPBASE_WORKER_MAX_ATTEMPTS"),
      pollIntervalMs: options.worker?.pollIntervalMs ?? inferNumberEnv("CHIMPBASE_WORKER_POLL_INTERVAL_MS"),
      retryDelayMs: options.worker?.retryDelayMs ?? inferNumberEnv("CHIMPBASE_WORKER_RETRY_DELAY_MS"),
    },
    workflows: {
      contractsDir: options.workflows?.contractsDir
        ?? getDenoEnv("CHIMPBASE_WORKFLOW_CONTRACTS_DIR")
        ?? undefined,
    },
  });

  const host = await ChimpbaseDenoHost.create({
    config,
    migrations: defineChimpbaseMigrations(options.migrations),
    migrationsDir: inferMigrationsDir(projectDir, options.migrationsDir ?? getDenoEnv("CHIMPBASE_MIGRATIONS_DIR"), options),
    migrationsSql: options.migrationsSql,
    projectDir,
  });

  if (options.modules && options.modules.length > 0) {
    host.registerFrom(...options.modules);
  }

  if (options.httpHandler) {
    host.setHttpHandler(
      typeof options.httpHandler === "function"
        ? options.httpHandler
        : options.httpHandler.fetch.bind(options.httpHandler),
    );
  }

  return host;
}

async function createChimpbaseDenoFrom(
  projectDir: string,
  options: CreateChimpbaseWithDefaultsOptions = {},
): Promise<ChimpbaseDenoHost> {
  const resolvedProjectDir = resolve(projectDir);
  if (!isCreateChimpbaseFromAppOptions(options)) {
    const app = await loadProjectAppDefinition(resolvedProjectDir);
    if (app) {
      return await createChimpbaseDenoImpl(buildLoadedAppCreateOptions(app, resolvedProjectDir, options));
    }
  }

  return await createChimpbaseDenoImpl({
    ...options,
    projectDir: resolvedProjectDir,
  });
}

export const createChimpbaseDeno = Object.assign(createChimpbaseDenoImpl, {
  from: createChimpbaseDenoFrom,
});

export async function runChimpbaseAction(
  actionName: string,
  args: unknown[] = [],
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
  args: unknown[] = [],
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

  const host = await ChimpbaseDenoHost.create({
    config,
    migrations: options.app.migrations,
    migrationsDir: inferMigrationsDir(projectDir, options.migrationsDir ?? getDenoEnv("CHIMPBASE_MIGRATIONS_DIR"), options),
    migrationsSql: options.migrationsSql,
    projectDir,
    secrets: options.secrets,
  });

  applyChimpbaseApp(host, options.app);
  return host;
}

function inferProjectName(projectDir: string): string {
  const envName = getDenoEnv("CHIMPBASE_PROJECT_NAME");
  if (envName) {
    return envName;
  }

  const name = basename(projectDir);
  return name || "chimpbase-app";
}

function inferServerPort(): number {
  const value = getDenoEnv("CHIMPBASE_SERVER_PORT") ?? getDenoEnv("PORT");
  const port = value ? Number(value) : NaN;
  return Number.isFinite(port) ? port : 3000;
}

function inferStorageEngine(options: Pick<CreateChimpbaseLegacyOptions, "storage"> | Pick<CreateChimpbaseFromAppOptions, "storage">): "memory" | "postgres" | "sqlite" {
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

function inferNumberEnv(name: string): number | undefined {
  const value = getDenoEnv(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferMigrationsDir(
  projectDir: string,
  configuredDir: string | undefined,
  options: CreateChimpbaseOptions,
): string | null {
  if (configuredDir) {
    return resolve(projectDir, configuredDir);
  }

  if (
    isCreateChimpbaseFromAppOptions(options)
    || ("migrations" in options && options.migrations !== undefined)
    || options.migrationsSql !== undefined
  ) {
    return null;
  }

  return resolve(projectDir, "migrations");
}

function applyChimpbaseApp(host: ChimpbaseDenoHost, app: ChimpbaseAppDefinition): void {
  if (app.registrations.length > 0) {
    host.register(app.registrations);
  }

  host.setHttpHandler(app.httpHandler);
}

function isCreateChimpbaseFromAppOptions(
  options: CreateChimpbaseOptions | CreateChimpbaseWithDefaultsOptions,
): options is CreateChimpbaseFromAppOptions | CreateChimpbaseFromAppWithDefaultsOptions {
  return "app" in options && options.app !== undefined;
}

function buildLoadedAppCreateOptions(
  app: ChimpbaseAppDefinition,
  projectDir: string,
  options: CreateChimpbaseLegacyWithDefaultsOptions,
): CreateChimpbaseFromAppOptions {
  return {
    app,
    migrationsDir: "migrationsDir" in options ? options.migrationsDir : undefined,
    migrationsSql: "migrationsSql" in options ? options.migrationsSql : undefined,
    projectDir,
    server: "server" in options ? options.server : undefined,
    storage: "storage" in options ? options.storage : undefined,
    telemetryRetention: "telemetry" in options ? options.telemetry?.retention : undefined,
    workerRuntime: "worker" in options
      ? {
          leaseMs: options.worker?.leaseMs,
          pollIntervalMs: options.worker?.pollIntervalMs,
        }
      : undefined,
  };
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
