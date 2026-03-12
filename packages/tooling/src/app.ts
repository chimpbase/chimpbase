import { access, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  defineChimpbaseApp,
  type ChimpbaseAppDefinition,
  type ChimpbaseAppDefinitionInput,
} from "@chimpbase/core";

const PROJECT_APP_MODULE_FILE = "chimpbase.app.ts";

export async function loadProjectAppDefinition(projectDir: string): Promise<ChimpbaseAppDefinition | null> {
  const appModulePath = await resolveProjectAppModulePath(projectDir);
  if (!appModulePath) {
    return null;
  }

  return await loadChimpbaseAppDefinitionModule(appModulePath);
}

export async function resolveProjectAppModulePath(projectDir: string): Promise<string | null> {
  const path = resolve(projectDir, PROJECT_APP_MODULE_FILE);
  if (await fileExists(path)) {
    return path;
  }

  return null;
}

export async function loadChimpbaseAppDefinitionModule(modulePath: string): Promise<ChimpbaseAppDefinition> {
  const tempModulePath = join(
    dirname(modulePath),
    `.__chimpbase_app_${globalThis.crypto.randomUUID()}${extname(modulePath) || ".ts"}`,
  );

  await writeFile(tempModulePath, await readFile(modulePath, "utf8"));

  try {
    const moduleExports = await import(pathToFileURL(tempModulePath).href);
    return coerceChimpbaseAppDefinition(moduleExports, modulePath);
  } finally {
    await rm(tempModulePath, { force: true });
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
