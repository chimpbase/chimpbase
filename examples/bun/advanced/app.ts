import { normalizeProjectConfig } from "@chimpbase/core";
import { createChimpbase } from "@chimpbase/bun";
import { createOtelSink } from "@chimpbase/otel";
import { loadLocalSecretStore } from "@chimpbase/tooling/secrets";

import app from "./chimpbase.app.ts";

const EXAMPLE_ENV_FILE = ".env";
const EXAMPLE_SECRETS_DIR = "run/secrets";

export async function createAdvancedApp() {
  const secrets = await loadLocalSecretStore(
    import.meta.dir,
    normalizeProjectConfig({
      secrets: { dir: EXAMPLE_SECRETS_DIR, envFile: EXAMPLE_ENV_FILE },
    }),
  );

  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const sinks = otelEndpoint
    ? [
        createOtelSink({
          endpoint: otelEndpoint,
          serviceName: process.env.OTEL_SERVICE_NAME ?? "bun-advanced",
        }),
      ]
    : [];

  return await createChimpbase({
    ...app,
    projectDir: import.meta.dir,
    secrets,
    sinks,
  });
}

if (import.meta.main) {
  const chimpbase = await createAdvancedApp();
  await chimpbase.start();
}
