import { resolve } from "node:path";

import {
  normalizeProjectConfig,
  type ChimpbaseProjectConfig,
} from "@chimpbase/core";

export {
  normalizeProjectConfig,
  type ChimpbaseProjectConfig,
  type ChimpbaseProjectConfigInput,
} from "@chimpbase/core";

export async function loadProjectConfig(
  projectDir: string,
  configFile = "chimpbase.toml",
): Promise<ChimpbaseProjectConfig> {
  const configPath = resolve(projectDir, configFile);
  const raw = await Bun.file(configPath).text();
  const parsed = Bun.TOML.parse(raw) as Record<string, Record<string, string | number>>;

  return normalizeProjectConfig({
    project: {
      name: hasValue(parsed.project, "name") ? String(parsed.project.name) : undefined,
    },
    server: {
      port: hasValue(parsed.server, "port") ? Number(parsed.server.port) : undefined,
    },
    storage: {
      engine: parsed.storage?.engine === "memory"
        ? "memory"
        : parsed.storage?.engine === "postgres"
          ? "postgres"
          : "sqlite",
      path: hasValue(parsed.storage, "path") ? String(parsed.storage.path) : null,
      url: hasValue(parsed.storage, "url") ? String(parsed.storage.url) : null,
    },
    worker: {
      leaseMs: hasValue(parsed.worker, "lease_ms") ? Number(parsed.worker.lease_ms) : undefined,
      maxAttempts: hasValue(parsed.worker, "max_attempts") ? Number(parsed.worker.max_attempts) : undefined,
      pollIntervalMs: hasValue(parsed.worker, "poll_interval_ms") ? Number(parsed.worker.poll_interval_ms) : undefined,
      retryDelayMs: hasValue(parsed.worker, "retry_delay_ms") ? Number(parsed.worker.retry_delay_ms) : undefined,
    },
    secrets: {
      dir: hasValue(parsed.secrets, "dir") ? String(parsed.secrets.dir) : undefined,
      envFile: hasValue(parsed.secrets, "env_file") ? String(parsed.secrets.env_file) : undefined,
    },
    workflows: {
      contractsDir: hasValue(parsed.workflows, "contracts_dir") ? String(parsed.workflows.contracts_dir) : undefined,
    },
  });
}

function hasValue(
  record: Record<string, string | number> | undefined,
  key: string,
): boolean {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}
