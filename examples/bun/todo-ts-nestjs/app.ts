import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import {
  action,
  subscription,
  worker,
} from "@chimpbase/runtime";
import { createChimpbase, defineChimpbaseApp } from "@chimpbase/bun";

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
      name: "todo-ts-nestjs",
    },
    registrations: [
      action("listProjects", projectActions.listProjects.bind(projectActions)),
      action("createProject", projectActions.createProject.bind(projectActions)),
      action("listTodos", todoActions.listTodos.bind(todoActions)),
      action("createTodo", todoActions.createTodo.bind(todoActions)),
      action("assignTodo", todoActions.assignTodo.bind(todoActions)),
      action("startTodo", todoActions.startTodo.bind(todoActions)),
      action("completeTodo", todoActions.completeTodo.bind(todoActions)),
      action("getTodoDashboard", todoActions.getTodoDashboard.bind(todoActions)),
      action("listTodoAuditLog", todoActions.listTodoAuditLog.bind(todoActions)),
      action("listTodoEvents", todoActions.listTodoEvents.bind(todoActions)),
      action("listTodoNotifications", todoActions.listTodoNotifications.bind(todoActions)),
      subscription("todo.created", todoSubscriptions.auditTodoCreated.bind(todoSubscriptions), { idempotent: true, name: "auditTodoCreated" }),
      subscription("todo.assigned", todoSubscriptions.auditTodoAssigned.bind(todoSubscriptions), { idempotent: true, name: "auditTodoAssigned" }),
      subscription("todo.started", todoSubscriptions.auditTodoStarted.bind(todoSubscriptions), { idempotent: true, name: "auditTodoStarted" }),
      subscription("todo.completed", todoSubscriptions.auditTodoCompleted.bind(todoSubscriptions), { idempotent: true, name: "auditTodoCompleted" }),
      subscription("todo.completed", todoSubscriptions.enqueueTodoCompletedNotification.bind(todoSubscriptions), { idempotent: true, name: "enqueueTodoCompletedNotification" }),
      action("listWorkspacePreferences", todoActions.listWorkspacePreferences.bind(todoActions)),
      action("setWorkspacePreference", todoActions.setWorkspacePreference.bind(todoActions)),
      action("addTodoNote", todoActions.addTodoNote.bind(todoActions)),
      action("listTodoNotes", todoActions.listTodoNotes.bind(todoActions)),
      action("listTodoActivityStream", todoActions.listTodoActivityStream.bind(todoActions)),
      worker("todo.completed.notify", todoWorkers.notifyTodoCompleted.bind(todoWorkers)),
      worker("todo.completed.notify.dlq", todoWorkers.captureTodoCompletedDlq.bind(todoWorkers), { dlq: false }),
      action("seedDemoWorkspace", todoActions.seedDemoWorkspace.bind(todoActions)),
    ],
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
