import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import { createChimpbase } from "@chimpbase/bun";

import { AppModule } from "./src/nest/app.module.ts";
import { todoApiApp } from "./src/http/app.ts";
import {
  ProjectActionsService,
} from "./src/modules/projects/project.nest.ts";
import {
  TodoActionsService,
  TodoSubscriptionsService,
  TodoQueuesService,
} from "./src/modules/todos/todo.nest.ts";

export async function createTodoApplication() {
  const nestApp = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const projectActions = nestApp.get(ProjectActionsService);
  const todoActions = nestApp.get(TodoActionsService);
  const todoSubscriptions = nestApp.get(TodoSubscriptionsService);
  const todoQueues = nestApp.get(TodoQueuesService);

  const chimpbase = await createChimpbase.from(import.meta.dir, {
    httpHandler: todoApiApp,
    modules: [projectActions, todoActions, todoSubscriptions, todoQueues],
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
  chimpbase.start();
}
