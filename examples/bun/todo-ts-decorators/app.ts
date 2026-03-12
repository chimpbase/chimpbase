import { createChimpbase } from "@chimpbase/bun";

import app from "./chimpbase.app.ts";
import { todoApiApp } from "./src/http/app.ts";

export async function createTodoApplication() {
  const chimpbase = await createChimpbase({
    app,
    projectDir: import.meta.dir,
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
