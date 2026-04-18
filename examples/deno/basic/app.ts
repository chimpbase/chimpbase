import { createChimpbase } from "@chimpbase/deno";

import app from "./chimpbase.app.ts";

const projectDir = new URL(".", import.meta.url).pathname;

export async function createBasicApp() {
  return await createChimpbase({
    ...app,
    projectDir,
    storage: { engine: "sqlite", path: "data/basic.sqlite3" },
  });
}

if (import.meta.main) {
  const chimpbase = await createBasicApp();
  await chimpbase.start();
}
