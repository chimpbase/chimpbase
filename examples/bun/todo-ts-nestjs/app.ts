import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import {
  action,
  queue,
  subscription,
} from "@chimpbase/runtime";
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
  });

  chimpbase.register(
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
    subscription("todo.created", todoSubscriptions.auditTodoCreated.bind(todoSubscriptions)),
    subscription("todo.assigned", todoSubscriptions.auditTodoAssigned.bind(todoSubscriptions)),
    subscription("todo.started", todoSubscriptions.auditTodoStarted.bind(todoSubscriptions)),
    subscription("todo.completed", todoSubscriptions.auditTodoCompleted.bind(todoSubscriptions)),
    subscription("todo.completed", todoSubscriptions.enqueueTodoCompletedNotification.bind(todoSubscriptions)),
    action("listWorkspacePreferences", todoActions.listWorkspacePreferences.bind(todoActions)),
    action("setWorkspacePreference", todoActions.setWorkspacePreference.bind(todoActions)),
    action("addTodoNote", todoActions.addTodoNote.bind(todoActions)),
    action("listTodoNotes", todoActions.listTodoNotes.bind(todoActions)),
    action("listTodoActivityStream", todoActions.listTodoActivityStream.bind(todoActions)),
    queue("todo.completed.notify", todoQueues.notifyTodoCompleted.bind(todoQueues)),
    queue("todo.completed.notify.dlq", todoQueues.captureTodoCompletedDlq.bind(todoQueues), { dlq: false }),
    action("seedDemoWorkspace", todoActions.seedDemoWorkspace.bind(todoActions)),
  );
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
