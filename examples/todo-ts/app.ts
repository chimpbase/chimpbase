import {
  action,
  listener,
  queue,
  registerChimpbaseEntries,
} from "@chimpbase/runtime";
import { createChimpbase } from "chimpbase-bun";

import { todoApiApp } from "./src/http/app.ts";
import {
  createProject,
  listProjects,
} from "./src/modules/projects/project.actions.ts";
import {
  assignTodo,
  completeTodo,
  createTodo,
  getTodoDashboard,
  listTodos,
  startTodo,
} from "./src/modules/todos/todo.actions.ts";
import {
  listTodoAuditLog,
  listTodoEvents,
  listTodoNotifications,
} from "./src/modules/todos/todo.audit.actions.ts";
import {
  auditTodoAssigned,
  auditTodoCompleted,
  auditTodoCreated,
  auditTodoStarted,
  enqueueTodoCompletedNotification,
} from "./src/modules/todos/todo.listeners.ts";
import {
  addTodoNote,
  listTodoActivityStream,
  listTodoNotes,
  listWorkspacePreferences,
  setWorkspacePreference,
} from "./src/modules/todos/todo.platform.actions.ts";
import {
  captureTodoCompletedDlq,
  notifyTodoCompleted,
} from "./src/modules/todos/todo.queues.ts";
import { seedDemoWorkspace } from "./src/modules/todos/todo.seed.actions.ts";

export async function createTodoApplication() {
  const chimpbase = await createChimpbase.from(import.meta.dir, {
    httpHandler: todoApiApp,
  });

  registerChimpbaseEntries(chimpbase, [
    action("listProjects", listProjects),
    action("createProject", createProject),
    action("listTodos", listTodos),
    action("createTodo", createTodo),
    action("assignTodo", assignTodo),
    action("startTodo", startTodo),
    action("completeTodo", completeTodo),
    action("getTodoDashboard", getTodoDashboard),
    action("listTodoAuditLog", listTodoAuditLog),
    action("listTodoEvents", listTodoEvents),
    action("listTodoNotifications", listTodoNotifications),
    listener("todo.created", auditTodoCreated),
    listener("todo.assigned", auditTodoAssigned),
    listener("todo.started", auditTodoStarted),
    listener("todo.completed", auditTodoCompleted),
    listener("todo.completed", enqueueTodoCompletedNotification),
    action("listWorkspacePreferences", listWorkspacePreferences),
    action("setWorkspacePreference", setWorkspacePreference),
    action("addTodoNote", addTodoNote),
    action("listTodoNotes", listTodoNotes),
    action("listTodoActivityStream", listTodoActivityStream),
    queue("todo.completed.notify", notifyTodoCompleted),
    queue("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),
    action("seedDemoWorkspace", seedDemoWorkspace),
  ]);
  return {
    chimpbase,
    todoApiApp,
  };
}

if (import.meta.main) {
  const { chimpbase } = await createTodoApplication();
  await chimpbase.start();
}
