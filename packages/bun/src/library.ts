import { basename, join, resolve } from "node:path";

import {
  defineChimpbaseApp,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
  normalizeProjectConfig,
  type ChimpbaseProjectConfigInput,
} from "@chimpbase/core";
import {
  type ChimpbaseRouteHandler,
} from "@chimpbase/runtime";
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

export async function loadChimpbaseProject(projectDir = "."): Promise<ChimpbaseBunHost> {
  return await ChimpbaseBunHost.load(resolve(projectDir));
}

export async function loadChimpbaseApp(
  definition: ChimpbaseAppDefinition,
): Promise<ChimpbaseBunHost> {
  const projectDir = resolve(definition.projectDir);
  return await ChimpbaseBunHost.create({
    config: definition,
    entrypointPath: resolve(projectDir, definition.entrypointPath),
    migrationsDir: definition.migrations.dir ? resolve(projectDir, definition.migrations.dir) : null,
    migrationsSql: definition.migrations.sql,
    projectDir,
  });
}

async function createChimpbaseImpl(
  options: CreateChimpbaseOptions = {},
): Promise<ChimpbaseBunHost> {
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
          ?? Bun.env.CHIMPBASE_STORAGE_PATH
          ?? join("data", `${inferProjectName(projectDir)}.db`),
      url: options.storage?.url
        ?? Bun.env.CHIMPBASE_DATABASE_URL
        ?? Bun.env.DATABASE_URL
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
        ?? Bun.env.CHIMPBASE_WORKFLOW_CONTRACTS_DIR
        ?? undefined,
    },
  });
  const host = await ChimpbaseBunHost.create({
    config,
    migrationsDir: resolve(projectDir, options.migrations?.dir ?? Bun.env.CHIMPBASE_MIGRATIONS_DIR ?? "migrations"),
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

async function createChimpbaseFrom(
  projectDir: string,
  options: CreateChimpbaseWithDefaultsOptions = {},
): Promise<ChimpbaseBunHost> {
  return await createChimpbaseImpl({
    ...options,
    projectDir,
  });
}

export const createChimpbase = Object.assign(createChimpbaseImpl, {
  from: createChimpbaseFrom,
});

export async function runChimpbaseAction(
  actionName: string,
  args: unknown[] = [],
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
  options: ChimpbaseAppDefinition & Pick<StartChimpbaseProjectOptions, "serve" | "runWorker">,
): Promise<StartedChimpbaseProject> {
  const host = await loadChimpbaseApp(options);
  return startLoadedHost(host, options.serve, options.runWorker);
}

export async function runChimpbaseAppAction(
  options: ChimpbaseAppDefinition,
  actionName: string,
  args: unknown[] = [],
): Promise<{ host: ChimpbaseBunHost; outcome: ActionExecutionResult }> {
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
};

function inferProjectName(projectDir: string): string {
  if (Bun.env.CHIMPBASE_PROJECT_NAME) {
    return Bun.env.CHIMPBASE_PROJECT_NAME;
  }

  const name = basename(projectDir);
  return name || "chimpbase-app";
}

function inferServerPort(): number {
  const value = Bun.env.CHIMPBASE_SERVER_PORT ?? Bun.env.PORT;
  const port = value ? Number(value) : NaN;
  return Number.isFinite(port) ? port : 3000;
}

function inferStorageEngine(options: CreateChimpbaseOptions): "memory" | "postgres" | "sqlite" {
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
