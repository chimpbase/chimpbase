import { access, rm, symlink } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ChimpbaseActionHandler,
  ChimpbaseListenerHandler,
  ChimpbaseQueueDefinition,
  ChimpbaseQueueHandler,
  ChimpbaseRouteHandler,
  ChimpbaseWorkflowDefinition,
} from "@chimpbase/runtime";

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

export interface ChimpbaseQueueRegistration {
  definition: Required<ChimpbaseQueueDefinition>;
  handler: ChimpbaseQueueHandler;
  name: string;
}

export interface ChimpbaseRegistry {
  actions: Map<string, ChimpbaseActionHandler>;
  httpHandler: ChimpbaseRouteHandler | null;
  listeners: Map<string, ChimpbaseListenerHandler[]>;
  queues: Map<string, ChimpbaseQueueRegistration>;
  workflows: Map<string, Map<number, ChimpbaseWorkflowDefinition>>;
}

export interface ChimpbaseEntrypointTarget {
  registerAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ): ChimpbaseActionHandler<TArgs, TResult>;
  registerListener<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseListenerHandler<TPayload, TResult>,
  ): ChimpbaseListenerHandler<TPayload, TResult>;
  registerQueue<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseQueueHandler<TPayload, TResult>,
    definition?: ChimpbaseQueueDefinition,
  ): ChimpbaseQueueHandler<TPayload, TResult>;
  registerWorkflow<TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ): ChimpbaseWorkflowDefinition<TInput, TState>;
  setHttpHandler(handler: ChimpbaseRouteHandler | null): void;
}

interface RuntimeGlobals {
  defineAction?: <TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ) => ChimpbaseActionHandler<TArgs, TResult>;
  defineListener?: <TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseListenerHandler<TPayload, TResult>,
  ) => ChimpbaseListenerHandler<TPayload, TResult>;
  defineQueue?: <TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseQueueHandler<TPayload, TResult>,
    definition?: ChimpbaseQueueDefinition,
  ) => ChimpbaseQueueHandler<TPayload, TResult>;
  defineWorkflow?: <TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ) => ChimpbaseWorkflowDefinition<TInput, TState>;
}

type RuntimeGlobalScope = typeof globalThis & RuntimeGlobals;

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
    httpHandler: null,
    listeners: new Map(),
    queues: new Map(),
    workflows: new Map(),
  };
}

export async function loadChimpbaseEntrypoint(
  entrypointInput: string,
  target: ChimpbaseEntrypointTarget,
): Promise<void> {
  const entrypointPath = await resolveEntrypointPath(entrypointInput);
  if (!entrypointPath) {
    throw new Error(`no runtime entrypoint found for ${entrypointInput}`);
  }

  await withChimpbaseRegistration(target, async () => {
    const entrypointAliasPath = join(
      dirname(entrypointPath),
      `.__chimpbase_entrypoint_${crypto.randomUUID()}${extname(entrypointPath) || ".ts"}`,
    );

    await symlink(entrypointPath, entrypointAliasPath);

    try {
      const entrypointModule = await import(pathToFileURL(entrypointAliasPath).href);
      target.setHttpHandler(resolveHttpHandler(entrypointModule));
    } finally {
      await rm(entrypointAliasPath, { force: true });
    }
  });
}

export async function withChimpbaseRegistration<TResult>(
  target: ChimpbaseEntrypointTarget,
  callback: () => TResult | Promise<TResult>,
): Promise<TResult> {
  const globals = globalThis as RuntimeGlobalScope;
  const previousDefineAction = globals.defineAction;
  const previousDefineListener = globals.defineListener;
  const previousDefineQueue = globals.defineQueue;
  const previousDefineWorkflow = globals.defineWorkflow;

  globals.defineAction = ((name: string, handler: ChimpbaseActionHandler) => {
    return target.registerAction(name, handler);
  }) as RuntimeGlobals["defineAction"];

  globals.defineListener = ((eventName: string, handler: ChimpbaseListenerHandler) => {
    return target.registerListener(eventName, handler);
  }) as RuntimeGlobals["defineListener"];

  globals.defineQueue = ((name: string, handler: ChimpbaseQueueHandler, definition?: ChimpbaseQueueDefinition) => {
    return target.registerQueue(name, handler, definition);
  }) as RuntimeGlobals["defineQueue"];

  globals.defineWorkflow = ((definition: ChimpbaseWorkflowDefinition) => {
    return target.registerWorkflow(definition);
  }) as RuntimeGlobals["defineWorkflow"];

  try {
    return await callback();
  } finally {
    globals.defineAction = previousDefineAction;
    globals.defineListener = previousDefineListener;
    globals.defineQueue = previousDefineQueue;
    globals.defineWorkflow = previousDefineWorkflow;
  }
}

export async function resolveEntrypointPath(entrypointInput: string): Promise<string | null> {
  if (await fileExists(entrypointInput)) {
    return entrypointInput;
  }

  return await findProjectEntrypoint(entrypointInput);
}

export function resolveHttpHandler(moduleExports: Record<string, unknown>): ChimpbaseRouteHandler | null {
  const directCandidates: unknown[] = [
    moduleExports.fetch,
    moduleExports.default,
    moduleExports.app,
    moduleExports.server,
  ];

  for (const candidate of directCandidates) {
    const handler = coerceHttpHandler(candidate);
    if (handler) {
      return handler;
    }
  }

  for (const candidate of Object.values(moduleExports)) {
    const handler = coerceHttpHandler(candidate);
    if (handler) {
      return handler;
    }
  }

  return null;
}

async function findProjectEntrypoint(projectDir: string): Promise<string | null> {
  for (const candidate of ["index.ts", "index.js"]) {
    const path = resolve(projectDir, candidate);
    if (await fileExists(path)) {
      return path;
    }
  }

  return null;
}

function coerceHttpHandler(candidate: unknown): ChimpbaseRouteHandler | null {
  if (typeof candidate === "function") {
    return candidate as ChimpbaseRouteHandler;
  }

  if (
    candidate &&
    typeof candidate === "object" &&
    "fetch" in candidate &&
    typeof candidate.fetch === "function"
  ) {
    return candidate.fetch.bind(candidate) as ChimpbaseRouteHandler;
  }

  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export {
  ChimpbaseEngine,
  type ChimpbaseActionExecutionResult,
  type ChimpbaseEngineAdapter,
  type ChimpbaseEngineOptions,
  type ChimpbaseEventRecord,
  type ChimpbaseExecutionScope,
  type ChimpbaseQueueExecutionResult,
  type ChimpbaseQueueJobRecord,
  type ChimpbaseRouteExecutionResult,
  type ChimpbaseTelemetryRecord,
} from "./engine.ts";
