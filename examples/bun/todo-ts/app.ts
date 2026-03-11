import {
  action,
  worker,
  subscription,
} from "@chimpbase/runtime";
import { createChimpbase } from "@chimpbase/bun";

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
} from "./src/modules/todos/todo.subscriptions.ts";
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
} from "./src/modules/todos/todo.workers.ts";
import { seedDemoWorkspace } from "./src/modules/todos/todo.seed.actions.ts";

const EXAMPLE_ENV_FILE = ".env";
const EXAMPLE_SECRETS_DIR = "run/secrets";

export async function createTodoApplication() {
  const chimpbase = await createChimpbase.from(import.meta.dir, {
    httpHandler: todoApiApp,
    secrets: {
      dir: EXAMPLE_SECRETS_DIR,
      envFile: EXAMPLE_ENV_FILE,
    },
  });

  chimpbase.register(
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
    subscription("todo.created", auditTodoCreated),
    subscription("todo.assigned", auditTodoAssigned),
    subscription("todo.started", auditTodoStarted),
    subscription("todo.completed", auditTodoCompleted),
    subscription("todo.completed", enqueueTodoCompletedNotification),
    action("listWorkspacePreferences", listWorkspacePreferences),
    action("setWorkspacePreference", setWorkspacePreference),
    action("addTodoNote", addTodoNote),
    action("listTodoNotes", listTodoNotes),
    action("listTodoActivityStream", listTodoActivityStream),
    worker("todo.completed.notify", notifyTodoCompleted),
    worker("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),
    action("seedDemoWorkspace", seedDemoWorkspace),
  );
  return {
    chimpbase,
    todoApiApp,
  };
}

if (import.meta.main) {
  const { chimpbase } = await createTodoApplication();
  await chimpbase.start();
}
