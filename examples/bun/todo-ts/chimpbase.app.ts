import { defineChimpbaseApp } from "@chimpbase/bun";
import {
  cron,
  subscription,
  worker,
} from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
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
  captureTodoBacklogSnapshot,
  listTodoBacklogSnapshots,
} from "./src/modules/todos/todo.cron.ts";
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

const registrations = [
  listProjects,
  createProject,
  listTodos,
  createTodo,
  assignTodo,
  startTodo,
  completeTodo,
  getTodoDashboard,
  listTodoAuditLog,
  listTodoEvents,
  listTodoNotifications,
  listTodoBacklogSnapshots,
  subscription("todo.created", auditTodoCreated, { idempotent: true, name: "auditTodoCreated" }),
  subscription("todo.assigned", auditTodoAssigned, { idempotent: true, name: "auditTodoAssigned" }),
  subscription("todo.started", auditTodoStarted, { idempotent: true, name: "auditTodoStarted" }),
  subscription("todo.completed", auditTodoCompleted, { idempotent: true, name: "auditTodoCompleted" }),
  subscription("todo.completed", enqueueTodoCompletedNotification, { idempotent: true, name: "enqueueTodoCompletedNotification" }),
  cron("todo.backlog.snapshot", "*/15 * * * *", captureTodoBacklogSnapshot),
  listWorkspacePreferences,
  setWorkspacePreference,
  addTodoNote,
  listTodoNotes,
  listTodoActivityStream,
  worker("todo.completed.notify", notifyTodoCompleted),
  worker("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),
  seedDemoWorkspace,
];

export default defineChimpbaseApp({
  httpHandler: todoApiApp,
  migrations,
  project: {
    name: "todo-ts",
  },
  registrations,
});
