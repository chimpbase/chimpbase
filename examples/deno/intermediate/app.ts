import { createChimpbase } from "@chimpbase/deno";

import app from "./chimpbase.app.ts";

const projectDir = new URL(".", import.meta.url).pathname;

export async function createIntermediateApp() {
  return await createChimpbase({
    ...app,
    projectDir,
  });
}

if (import.meta.main) {
  const chimpbase = await createIntermediateApp();
  await chimpbase.start();
}
