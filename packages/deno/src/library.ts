import { basename, join, resolve } from "node:path";

import {
  defineChimpbaseApp,
  normalizeProjectConfig,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
  type ChimpbaseProjectConfigInput,
} from "@chimpbase/core";
import type { ChimpbaseRouteHandler } from "@chimpbase/runtime";
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

export interface CreateChimpbaseOptions extends ChimpbaseProjectConfigInput {
  httpHandler?: ChimpbaseRouteHandler | { fetch: ChimpbaseRouteHandler };
  migrations?: {
    dir?: string;
    sql?: string[];
  };
  modules?: object[];
  projectDir?: string;
}

export interface CreateChimpbaseWithDefaultsOptions extends Omit<CreateChimpbaseOptions, "projectDir"> {}

export interface SyncChimpbaseWorkflowContractsOptions extends WorkflowContractSyncOptions {
  projectDir?: string;
}

export interface SyncChimpbaseSchemaOptions extends ChimpbaseSchemaSyncOptions {
  projectDir?: string;
}

export async function loadChimpbaseProject(projectDir = "."): Promise<ChimpbaseDenoHost> {
  return await ChimpbaseDenoHost.load(resolve(projectDir));
}

export async function loadChimpbaseApp(
  definition: ChimpbaseAppDefinition,
): Promise<ChimpbaseDenoHost> {
  const projectDir = resolve(definition.projectDir);
  return await ChimpbaseDenoHost.create({
    config: definition,
    entrypointPath: resolve(projectDir, definition.entrypointPath),
    migrationsDir: definition.migrations.dir ? resolve(projectDir, definition.migrations.dir) : null,
    migrationsSql: definition.migrations.sql,
    projectDir,
  });
}

async function createChimpbaseDenoImpl(
  options: CreateChimpbaseOptions = {},
): Promise<ChimpbaseDenoHost> {
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
    migrationsDir: resolve(projectDir, options.migrations?.dir ?? getDenoEnv("CHIMPBASE_MIGRATIONS_DIR") ?? "migrations"),
    migrationsSql: options.migrations?.sql,
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
  return await createChimpbaseDenoImpl({
    ...options,
    projectDir,
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
  options: ChimpbaseAppDefinition & Pick<StartChimpbaseProjectOptions, "serve" | "runWorker">,
): Promise<StartedChimpbaseProject> {
  const host = await loadChimpbaseApp(options);
  return startLoadedHost(host, options.serve, options.runWorker);
}

export async function runChimpbaseAppAction(
  options: ChimpbaseAppDefinition,
  actionName: string,
  args: unknown[] = [],
): Promise<{ host: ChimpbaseDenoHost; outcome: ActionExecutionResult }> {
  const host = await loadChimpbaseApp(options);

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

function inferStorageEngine(options: CreateChimpbaseOptions): "memory" | "postgres" | "sqlite" {
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
