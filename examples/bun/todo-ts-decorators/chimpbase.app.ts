import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { registrationsFrom } from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
import { todoApiApp } from "./src/http/app.ts";
import { ProjectRepository } from "./src/modules/projects/project.repository.ts";
import { ProjectModule } from "./src/modules/projects/project.module.ts";
import { TodoRepository } from "./src/modules/todos/todo.repository.ts";
import { TodoModule } from "./src/modules/todos/todo.module.ts";

const projectRepository = new ProjectRepository();
const todoRepository = new TodoRepository();

const projectModule = new ProjectModule(projectRepository);
const todoModule = new TodoModule(todoRepository, projectRepository);

export default {
  httpHandler: todoApiApp,
  migrations,
  project: {
    name: "todo-ts-decorators",
  },
  registrations: registrationsFrom(projectModule, todoModule),
} satisfies ChimpbaseAppDefinitionInput;
