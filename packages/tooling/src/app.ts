import { access, rm, symlink } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  defineChimpbaseApp,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
} from "@chimpbase/core";

const PROJECT_APP_MODULE_CANDIDATES = [
  "chimpbase.app.ts",
  "chimpbase.app.js",
  "chimpbase.app.mts",
  "chimpbase.app.mjs",
] as const;

export async function loadProjectAppDefinition(projectDir: string): Promise<ChimpbaseAppDefinition | null> {
  const appModulePath = await resolveProjectAppModulePath(projectDir);
  if (!appModulePath) {
    return null;
  }

  return await loadChimpbaseAppDefinitionModule(appModulePath);
}

export async function resolveProjectAppModulePath(projectDir: string): Promise<string | null> {
  for (const candidate of PROJECT_APP_MODULE_CANDIDATES) {
    const path = resolve(projectDir, candidate);
    if (await fileExists(path)) {
      return path;
    }
  }

  return null;
}

export async function loadChimpbaseAppDefinitionModule(modulePath: string): Promise<ChimpbaseAppDefinition> {
  const aliasPath = join(
    dirname(modulePath),
    `.__chimpbase_app_${globalThis.crypto.randomUUID()}${extname(modulePath) || ".ts"}`,
  );

  await symlink(modulePath, aliasPath);

  try {
    const moduleExports = await import(pathToFileURL(aliasPath).href);
    return coerceChimpbaseAppDefinition(moduleExports, modulePath);
  } finally {
    await rm(aliasPath, { force: true });
  }
}

function coerceChimpbaseAppDefinition(
  moduleExports: Record<string, unknown>,
  modulePath: string,
): ChimpbaseAppDefinition {
  const candidate = moduleExports.default ?? moduleExports.app;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`project app module must export a default object or named "app": ${modulePath}`);
  }

  return defineChimpbaseApp(candidate as ChimpbaseAppDefinitionInput);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
