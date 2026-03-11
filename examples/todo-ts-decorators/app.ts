import { createChimpbase } from "chimpbase-bun";

import { todoApiApp } from "./src/http/app.ts";
import { ProjectModule } from "./src/modules/projects/project.module.ts";
import { TodoModule } from "./src/modules/todos/todo.module.ts";

export async function createTodoApplication() {
  const chimpbase = await createChimpbase.from(import.meta.dir, {
    httpHandler: todoApiApp,
    modules: [ProjectModule, TodoModule],
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
