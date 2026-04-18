import { createChimpbase } from "@chimpbase/bun";

import app from "./chimpbase.app.ts";

export async function createBasicApp() {
  return await createChimpbase({
    ...app,
    projectDir: import.meta.dir,
    storage: { engine: "sqlite", path: "data/basic.sqlite3" },
  });
}

if (import.meta.main) {
  const chimpbase = await createBasicApp();
  await chimpbase.start();
}
