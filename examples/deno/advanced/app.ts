import { normalizeProjectConfig } from "@chimpbase/core";
import { createChimpbase } from "@chimpbase/deno";
import { createOtelSink } from "@chimpbase/otel";
import { loadLocalSecretStore } from "@chimpbase/tooling/secrets";

import app from "./chimpbase.app.ts";

const EXAMPLE_ENV_FILE = ".env";
const EXAMPLE_SECRETS_DIR = "run/secrets";
const projectDir = new URL(".", import.meta.url).pathname;

export async function createAdvancedApp() {
  const secrets = await loadLocalSecretStore(
    projectDir,
    normalizeProjectConfig({
      secrets: { dir: EXAMPLE_SECRETS_DIR, envFile: EXAMPLE_ENV_FILE },
    }),
  );

  const otelEndpoint = Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT");
  const sinks = otelEndpoint
    ? [
        createOtelSink({
          endpoint: otelEndpoint,
          serviceName: Deno.env.get("OTEL_SERVICE_NAME") ?? "deno-advanced",
        }),
      ]
    : [];

  return await createChimpbase({
    ...app,
    projectDir,
    secrets,
    sinks,
  });
}

if (import.meta.main) {
  const chimpbase = await createAdvancedApp();
  await chimpbase.start();
}
