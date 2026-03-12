import type {
  ChimpbaseActionHandler,
  ChimpbaseCronHandler,
  ChimpbaseRouteHandler,
  ChimpbaseSubscriptionHandler,
  ChimpbaseWorkerDefinition,
  ChimpbaseWorkerHandler,
  ChimpbaseWorkflowDefinition,
} from "@chimpbase/runtime";

export type ChimpbaseTelemetryPersistOverride =
  | boolean
  | { log?: boolean; metric?: boolean; trace?: boolean };

export interface ChimpbaseProjectConfig {
  project: {
    name: string;
  };
  server: {
    port: number;
  };
  storage: {
    engine: "memory" | "postgres" | "sqlite";
    path: string | null;
    url: string | null;
  };
  telemetry: {
    minLevel: "debug" | "info" | "warn" | "error";
    persist: { log: boolean; metric: boolean; trace: boolean };
    retention: { enabled: boolean; maxAgeDays: number; schedule: string };
  };
  worker: {
    leaseMs: number;
    maxAttempts: number;
    pollIntervalMs: number;
    retryDelayMs: number;
  };
  secrets: {
    dir: string | null;
    envFile: string | null;
  };
  workflows: {
    contractsDir: string | null;
  };
}

export interface ChimpbaseProjectConfigInput {
  project?: {
    name?: string;
  };
  server?: {
    port?: number;
  };
  storage?: {
    engine?: "memory" | "postgres" | "sqlite";
    path?: string | null;
    url?: string | null;
  };
  worker?: {
    leaseMs?: number;
    maxAttempts?: number;
    pollIntervalMs?: number;
    retryDelayMs?: number;
  };
  secrets?: {
    dir?: string | null;
    envFile?: string | null;
  };
  telemetry?: {
    minLevel?: "debug" | "info" | "warn" | "error";
    persist?: { log?: boolean; metric?: boolean; trace?: boolean };
    retention?: { enabled?: boolean; maxAgeDays?: number; schedule?: string };
  };
  workflows?: {
    contractsDir?: string | null;
  };
}

export interface ChimpbaseAppDefinition extends ChimpbaseProjectConfig {
  entrypointPath: string;
  migrations: {
    dir: string | null;
    sql: string[];
  };
  projectDir: string;
}

export interface ChimpbaseAppDefinitionInput extends ChimpbaseProjectConfigInput {
  entrypointPath: string;
  migrations?: {
    dir?: string;
    sql?: string[];
  };
  projectDir?: string;
}

export interface ChimpbaseWorkerRegistration {
  definition: Required<ChimpbaseWorkerDefinition>;
  handler: ChimpbaseWorkerHandler;
  name: string;
}

export interface ChimpbaseCronRegistration {
  handler: ChimpbaseCronHandler;
  name: string;
  schedule: string;
}

export interface ChimpbaseRegistry {
  actions: Map<string, ChimpbaseActionHandler>;
  crons: Map<string, ChimpbaseCronRegistration>;
  httpHandler: ChimpbaseRouteHandler | null;
  subscriptions: Map<string, ChimpbaseSubscriptionHandler[]>;
  telemetryOverrides: Map<string, ChimpbaseTelemetryPersistOverride>;
  workers: Map<string, ChimpbaseWorkerRegistration>;
  workflows: Map<string, Map<number, ChimpbaseWorkflowDefinition>>;
}

export interface ChimpbaseEntrypointTarget {
  registerAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ): ChimpbaseActionHandler<TArgs, TResult>;
  registerSubscription<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
  ): ChimpbaseSubscriptionHandler<TPayload, TResult>;
  registerWorker<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseWorkerHandler<TPayload, TResult>,
    definition?: ChimpbaseWorkerDefinition,
  ): ChimpbaseWorkerHandler<TPayload, TResult>;
  registerCron<TResult = unknown>(
    name: string,
    schedule: string,
    handler: ChimpbaseCronHandler<TResult>,
  ): ChimpbaseCronHandler<TResult>;
  registerWorkflow<TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ): ChimpbaseWorkflowDefinition<TInput, TState>;
  setHttpHandler(handler: ChimpbaseRouteHandler | null): void;
}

export function normalizeProjectConfig(
  input: ChimpbaseProjectConfigInput = {},
): ChimpbaseProjectConfig {
  return {
    project: {
      name: input.project?.name ?? "chimpbase-app",
    },
    server: {
      port: input.server?.port ?? 3000,
    },
    storage: {
      engine: input.storage?.engine ?? "sqlite",
      path: input.storage?.path ?? null,
      url: input.storage?.url ?? null,
    },
    worker: {
      leaseMs: input.worker?.leaseMs ?? 30_000,
      maxAttempts: input.worker?.maxAttempts ?? 5,
      pollIntervalMs: input.worker?.pollIntervalMs ?? 250,
      retryDelayMs: input.worker?.retryDelayMs ?? 1_000,
    },
    secrets: {
      dir: input.secrets?.dir ?? null,
      envFile: input.secrets?.envFile ?? null,
    },
    telemetry: {
      minLevel: input.telemetry?.minLevel ?? "debug",
      persist: {
        log: input.telemetry?.persist?.log ?? false,
        metric: input.telemetry?.persist?.metric ?? false,
        trace: input.telemetry?.persist?.trace ?? false,
      },
      retention: {
        enabled: input.telemetry?.retention?.enabled ?? false,
        maxAgeDays: input.telemetry?.retention?.maxAgeDays ?? 30,
        schedule: input.telemetry?.retention?.schedule ?? "0 2 * * *",
      },
    },
    workflows: {
      contractsDir: input.workflows?.contractsDir ?? "workflow-contracts",
    },
  };
}

export function defineChimpbaseApp(
  input: ChimpbaseAppDefinitionInput,
): ChimpbaseAppDefinition {
  return {
    ...normalizeProjectConfig(input),
    entrypointPath: input.entrypointPath,
    migrations: {
      dir: input.migrations?.dir ?? null,
      sql: input.migrations?.sql ?? [],
    },
    projectDir: input.projectDir ?? ".",
  };
}

export function createChimpbaseRegistry(): ChimpbaseRegistry {
  return {
    actions: new Map(),
    crons: new Map(),
    httpHandler: null,
    subscriptions: new Map(),
    telemetryOverrides: new Map(),
    workers: new Map(),
    workflows: new Map(),
  };
}

export {
  ChimpbaseEngine,
  type ChimpbaseActionExecutionResult,
  type ChimpbaseCronScheduleExecutionResult,
  type ChimpbaseEngineAdapter,
  type ChimpbaseEngineOptions,
  type ChimpbaseEventRecord,
  type ChimpbaseExecutionScope,
  type ChimpbaseQueueExecutionResult,
  type ChimpbaseQueueJobRecord,
  type ChimpbaseRouteExecutionResult,
  type ChimpbaseTelemetryRecord,
} from "./engine.ts";

export {
  createDefaultChimpbasePlatformShim,
  type ChimpbaseDrainOptions,
  type ChimpbaseDrainResult,
  type ChimpbaseMigration,
  type ChimpbaseMigrationSource,
  type ChimpbasePlatformShim,
  type ChimpbaseSecretsSource,
} from "./host.ts";
