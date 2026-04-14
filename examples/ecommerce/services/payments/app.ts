import { createChimpbase } from "@chimpbase/bun";
import { normalizeProjectConfig } from "@chimpbase/core";
import { loadLocalSecretStore } from "@chimpbase/tooling/secrets";

import appDefinition, { SERVER_PORT } from "./chimpbase.app.ts";

const secrets = await loadLocalSecretStore(
  import.meta.dir,
  normalizeProjectConfig({
    secrets: { envFile: ".env" },
  }),
);

const chimpbase = await createChimpbase({
  ...appDefinition,
  projectDir: import.meta.dir,
  secrets,
  server: { port: SERVER_PORT },
});

await chimpbase.start();
