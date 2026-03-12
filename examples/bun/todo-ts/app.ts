import { normalizeProjectConfig } from "@chimpbase/core";
import { createChimpbase } from "@chimpbase/bun";
import { loadLocalSecretStore } from "@chimpbase/tooling/secrets";

import app from "./chimpbase.app.ts";
import { todoApiApp } from "./src/http/app.ts";

const EXAMPLE_ENV_FILE = ".env";
const EXAMPLE_SECRETS_DIR = "run/secrets";

export async function createTodoApplication() {
  const secrets = await loadLocalSecretStore(
    import.meta.dir,
    normalizeProjectConfig({
      secrets: {
        dir: EXAMPLE_SECRETS_DIR,
        envFile: EXAMPLE_ENV_FILE,
      },
    }),
  );
  const chimpbase = await createChimpbase({
    app,
    projectDir: import.meta.dir,
    secrets,
  });

  return {
    chimpbase,
    todoApiApp,
  };
}

if (import.meta.main) {
  const { chimpbase } = await createTodoApplication();
  await chimpbase.start();
}
