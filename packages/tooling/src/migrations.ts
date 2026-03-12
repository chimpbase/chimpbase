import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import type { ChimpbaseMigration, ChimpbaseProjectConfig } from "@chimpbase/core";

export interface SqlMigration extends ChimpbaseMigration {}

export async function resolveLocalMigrationsDir(
  migrationsDir: string | null,
  engine: ChimpbaseProjectConfig["storage"]["engine"],
): Promise<string | null> {
  if (!migrationsDir) {
    return null;
  }

  const engineDir = resolve(migrationsDir, engine);
  return await directoryHasSqlFiles(engineDir) ? engineDir : migrationsDir;
}

export async function resolvePostgresMigrationsDir(projectDir: string): Promise<string | null> {
  const baseDir = resolve(projectDir, "migrations");
  const postgresDir = join(baseDir, "postgres");

  if (await directoryHasSqlFiles(postgresDir)) {
    return postgresDir;
  }

  return await directoryHasSqlFiles(baseDir) ? baseDir : null;
}

export async function readSqlMigrations(migrationsDir: string | null): Promise<SqlMigration[]> {
  if (!migrationsDir) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return [];
  }

  const migrations = entries
    .filter((entry) => extname(entry) === ".sql")
    .sort();

  return await Promise.all(
    migrations.map(async (name) => ({
      name,
      sql: await readFile(resolve(migrationsDir, name), "utf8"),
    })),
  );
}

export async function directoryHasSqlFiles(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.some((entry) => entry.endsWith(".sql"));
  } catch {
    return false;
  }
}
