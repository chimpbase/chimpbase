import { access, rm, symlink } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ChimpbaseEntrypointTarget,
} from "@chimpbase/core";
import type {
  ChimpbaseActionHandler,
  ChimpbaseCronHandler,
  ChimpbaseRouteHandler,
  ChimpbaseSubscriptionHandler,
  ChimpbaseWorkerDefinition,
  ChimpbaseWorkerHandler,
  ChimpbaseWorkflowDefinition,
} from "@chimpbase/runtime";

interface RuntimeGlobals {
  defineAction?: <TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ) => ChimpbaseActionHandler<TArgs, TResult>;
  defineSubscription?: <TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
  ) => ChimpbaseSubscriptionHandler<TPayload, TResult>;
  defineWorker?: <TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseWorkerHandler<TPayload, TResult>,
    definition?: ChimpbaseWorkerDefinition,
  ) => ChimpbaseWorkerHandler<TPayload, TResult>;
  defineCron?: <TResult = unknown>(
    name: string,
    schedule: string,
    handler: ChimpbaseCronHandler<TResult>,
  ) => ChimpbaseCronHandler<TResult>;
  defineWorkflow?: <TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ) => ChimpbaseWorkflowDefinition<TInput, TState>;
}

type RuntimeGlobalScope = typeof globalThis & RuntimeGlobals;

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
      `.__chimpbase_entrypoint_${globalThis.crypto.randomUUID()}${extname(entrypointPath) || ".ts"}`,
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
  const previousDefineCron = globals.defineCron;
  const previousDefineSubscription = globals.defineSubscription;
  const previousDefineWorker = globals.defineWorker;
  const previousDefineWorkflow = globals.defineWorkflow;

  globals.defineAction = ((name: string, handler: ChimpbaseActionHandler) => {
    return target.registerAction(name, handler);
  }) as RuntimeGlobals["defineAction"];

  globals.defineSubscription = ((eventName: string, handler: ChimpbaseSubscriptionHandler) => {
    return target.registerSubscription(eventName, handler);
  }) as RuntimeGlobals["defineSubscription"];

  globals.defineWorker = ((name: string, handler: ChimpbaseWorkerHandler, definition?: ChimpbaseWorkerDefinition) => {
    return target.registerWorker(name, handler, definition);
  }) as RuntimeGlobals["defineWorker"];

  globals.defineCron = ((name: string, schedule: string, handler: ChimpbaseCronHandler) => {
    return target.registerCron(name, schedule, handler);
  }) as RuntimeGlobals["defineCron"];

  globals.defineWorkflow = ((definition: ChimpbaseWorkflowDefinition) => {
    return target.registerWorkflow(definition);
  }) as RuntimeGlobals["defineWorkflow"];

  try {
    return await callback();
  } finally {
    globals.defineAction = previousDefineAction;
    globals.defineCron = previousDefineCron;
    globals.defineSubscription = previousDefineSubscription;
    globals.defineWorker = previousDefineWorker;
    globals.defineWorkflow = previousDefineWorkflow;
  }
}

async function resolveEntrypointPath(entrypointInput: string): Promise<string | null> {
  if (await fileExists(entrypointInput)) {
    return entrypointInput;
  }

  return await findProjectEntrypoint(entrypointInput);
}

function resolveHttpHandler(moduleExports: Record<string, unknown>): ChimpbaseRouteHandler | null {
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
