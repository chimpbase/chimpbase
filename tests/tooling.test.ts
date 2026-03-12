import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { loadProjectConfig } from "../packages/tooling/src/config.ts";
import {
  readSqlMigrations,
  resolveLocalMigrationsDir,
  resolvePostgresMigrationsDir,
} from "../packages/tooling/src/migrations.ts";
import { loadLocalSecretStore } from "../packages/tooling/src/secrets.ts";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    await rm(cleanupDirs.pop()!, { force: true, recursive: true });
  }
});

describe("@chimpbase/tooling", () => {
  test("loads chimpbase.toml with nested telemetry sections", async () => {
    const projectDir = await createTempDir("config");
    await writeFile(
      resolve(projectDir, "chimpbase.toml"),
      [
        "# project metadata",
        "[project]",
        'name = "tooling-config"',
        "",
        "[server]",
        "port = 4123",
        "",
        "[storage]",
        'engine = "postgres"',
        'url = "postgres://example.test/chimpbase"',
        "",
        "[worker]",
        "lease_ms = 45000",
        "max_attempts = 9",
        "poll_interval_ms = 800",
        "retry_delay_ms = 1200",
        "",
        "[secrets]",
        'dir = "run/secrets"',
        'env_file = ".env.local"',
        "",
        "[workflows]",
        'contracts_dir = "contracts"',
        "",
        "[telemetry]",
        'min_level = "warn"',
        "",
        "[telemetry.persist]",
        "log = true",
        "metric = true",
        "trace = false",
        "",
        "[telemetry.retention]",
        "enabled = true",
        "max_age_days = 14",
        'schedule = "0 3 * * *"',
        "",
      ].join("\n"),
    );

    const config = await loadProjectConfig(projectDir);

    expect(config.project.name).toBe("tooling-config");
    expect(config.server.port).toBe(4123);
    expect(config.storage).toEqual({
      engine: "postgres",
      path: null,
      url: "postgres://example.test/chimpbase",
    });
    expect(config.worker).toEqual({
      leaseMs: 45000,
      maxAttempts: 9,
      pollIntervalMs: 800,
      retryDelayMs: 1200,
    });
    expect(config.secrets).toEqual({
      dir: "run/secrets",
      envFile: ".env.local",
    });
    expect(config.workflows.contractsDir).toBe("contracts");
    expect(config.telemetry).toEqual({
      minLevel: "warn",
      persist: {
        log: true,
        metric: true,
        trace: false,
      },
      retention: {
        enabled: true,
        maxAgeDays: 14,
        schedule: "0 3 * * *",
      },
    });
  });

  test("loads local secrets with dotenv < env < mounted file precedence", async () => {
    const projectDir = await createTempDir("secrets");
    await mkdir(resolve(projectDir, "run/secrets"), { recursive: true });
    await writeFile(resolve(projectDir, ".env"), "APP_TOKEN=dotenv-token\nSHARED=dotenv-shared\n");
    await writeFile(resolve(projectDir, "run/secrets/APP_TOKEN"), "mounted-token");

    const store = await loadLocalSecretStore(
      projectDir,
      {
        project: { name: "tooling" },
        secrets: { dir: "run/secrets", envFile: ".env" },
        server: { port: 3000 },
        storage: { engine: "memory", path: null, url: null },
        telemetry: {
          minLevel: "debug",
          persist: { log: false, metric: false, trace: false },
          retention: { enabled: false, maxAgeDays: 30, schedule: "0 2 * * *" },
        },
        worker: {
          leaseMs: 30000,
          maxAttempts: 5,
          pollIntervalMs: 250,
          retryDelayMs: 1000,
        },
        workflows: { contractsDir: "workflow-contracts" },
      },
      {
        env: {
          APP_TOKEN: "env-token",
          SHARED: "env-shared",
        },
      },
    );

    expect(store.get("APP_TOKEN")).toBe("mounted-token");
    expect(store.get("SHARED")).toBe("env-shared");
    expect(store.get("MISSING")).toBeNull();
  });

  test("resolves engine-specific migration directories and reads sorted SQL files", async () => {
    const projectDir = await createTempDir("migrations");
    await mkdir(resolve(projectDir, "migrations/sqlite"), { recursive: true });
    await writeFile(resolve(projectDir, "migrations/sqlite/002_second.sql"), "SELECT 2;");
    await writeFile(resolve(projectDir, "migrations/sqlite/001_first.sql"), "SELECT 1;");

    const migrationsDir = await resolveLocalMigrationsDir(resolve(projectDir, "migrations"), "sqlite");
    const migrations = await readSqlMigrations(migrationsDir);

    expect(migrationsDir).toBe(resolve(projectDir, "migrations/sqlite"));
    expect(migrations.map((entry) => entry.name)).toEqual([
      "001_first.sql",
      "002_second.sql",
    ]);
    expect(migrations.map((entry) => entry.sql.trim())).toEqual([
      "SELECT 1;",
      "SELECT 2;",
    ]);
  });

  test("prefers postgres migrations folder and falls back to base migrations", async () => {
    const postgresProjectDir = await createTempDir("postgres-migrations");
    await mkdir(resolve(postgresProjectDir, "migrations/postgres"), { recursive: true });
    await writeFile(resolve(postgresProjectDir, "migrations/postgres/001_init.sql"), "SELECT 1;");

    const baseProjectDir = await createTempDir("base-migrations");
    await mkdir(resolve(baseProjectDir, "migrations"), { recursive: true });
    await writeFile(resolve(baseProjectDir, "migrations/001_init.sql"), "SELECT 1;");

    expect(await resolvePostgresMigrationsDir(postgresProjectDir)).toBe(resolve(postgresProjectDir, "migrations/postgres"));
    expect(await resolvePostgresMigrationsDir(baseProjectDir)).toBe(resolve(baseProjectDir, "migrations"));
  });
});

async function createTempDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `chimpbase-tooling-${label}-`));
  cleanupDirs.push(dir);
  return dir;
}
