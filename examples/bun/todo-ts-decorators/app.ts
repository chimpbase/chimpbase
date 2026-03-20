import { chimpbase } from "./chimpbase.app.ts";
import { todoApiApp } from "./src/http/app.ts";

export async function createTodoApplication() {
  return {
    chimpbase,
    todoApiApp,
  };
}

if (import.meta.main) {
  const { chimpbase } = await createTodoApplication();
  await chimpbase.start();
}
