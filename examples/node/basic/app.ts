import { fileURLToPath } from "node:url";

import { createChimpbase } from "@chimpbase/node";

import app from "./chimpbase.app.ts";

const projectDir = fileURLToPath(new URL(".", import.meta.url));

export async function createBasicApp() {
  return await createChimpbase({
    ...app,
    projectDir,
    storage: { engine: "sqlite", path: "data/basic.sqlite3" },
  });
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const chimpbase = await createBasicApp();
  await chimpbase.start();
}
