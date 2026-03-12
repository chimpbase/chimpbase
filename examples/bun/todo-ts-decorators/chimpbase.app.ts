import { defineChimpbaseApp } from "@chimpbase/bun";
import { registrationsFrom } from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
import { todoApiApp } from "./src/http/app.ts";
import { ProjectModule } from "./src/modules/projects/project.module.ts";
import { TodoModule } from "./src/modules/todos/todo.module.ts";

export default defineChimpbaseApp({
  httpHandler: todoApiApp,
  migrations,
  project: {
    name: "todo-ts-decorators",
  },
  registrations: registrationsFrom(ProjectModule, TodoModule),
});
