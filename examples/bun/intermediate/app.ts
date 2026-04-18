import { createChimpbase } from "@chimpbase/bun";

import app from "./chimpbase.app.ts";

export async function createIntermediateApp() {
  return await createChimpbase({
    ...app,
    projectDir: import.meta.dir,
  });
}

if (import.meta.main) {
  const chimpbase = await createIntermediateApp();
  await chimpbase.start();
}
