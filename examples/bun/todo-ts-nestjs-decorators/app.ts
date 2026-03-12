import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import { createChimpbase, defineChimpbaseApp } from "@chimpbase/bun";
import { registrationsFrom } from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
import { AppModule } from "./src/nest/app.module.ts";
import { todoApiApp } from "./src/http/app.ts";
import {
  ProjectActionsService,
} from "./src/modules/projects/project.nest.ts";
import {
  TodoActionsService,
  TodoSubscriptionsService,
  TodoWorkersService,
} from "./src/modules/todos/todo.nest.ts";

export async function createTodoApplication() {
  const nestApp = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const projectActions = nestApp.get(ProjectActionsService);
  const todoActions = nestApp.get(TodoActionsService);
  const todoSubscriptions = nestApp.get(TodoSubscriptionsService);
  const todoWorkers = nestApp.get(TodoWorkersService);

  const app = defineChimpbaseApp({
    httpHandler: todoApiApp,
    migrations,
    project: {
      name: "todo-ts-nestjs-decorators",
    },
    registrations: registrationsFrom(
      projectActions,
      todoActions,
      todoSubscriptions,
      todoWorkers,
    ),
  });
  const chimpbase = await createChimpbase({
    app,
    projectDir: import.meta.dir,
  });
  return {
    chimpbase,
    close: async () => {
      chimpbase.close();
      await nestApp.close();
    },
    nestApp,
    todoApiApp,
  };
}

if (import.meta.main) {
  const { chimpbase } = await createTodoApplication();
  await chimpbase.start();
}
