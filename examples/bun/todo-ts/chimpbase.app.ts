import { defineChimpbaseApp } from "@chimpbase/bun";
import {
  action,
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
  action("listTodoBacklogSnapshots", listTodoBacklogSnapshots),
  subscription("todo.created", auditTodoCreated),
  subscription("todo.assigned", auditTodoAssigned),
  subscription("todo.started", auditTodoStarted),
  subscription("todo.completed", auditTodoCompleted),
  subscription("todo.completed", enqueueTodoCompletedNotification),
  cron("todo.backlog.snapshot", "*/15 * * * *", captureTodoBacklogSnapshot),
  action("listWorkspacePreferences", listWorkspacePreferences),
  action("setWorkspacePreference", setWorkspacePreference),
  action("addTodoNote", addTodoNote),
  action("listTodoNotes", listTodoNotes),
  action("listTodoActivityStream", listTodoActivityStream),
  worker("todo.completed.notify", notifyTodoCompleted),
  worker("todo.completed.notify.dlq", captureTodoCompletedDlq, { dlq: false }),
  action("seedDemoWorkspace", seedDemoWorkspace),
];

export default defineChimpbaseApp({
  httpHandler: todoApiApp,
  migrations,
  project: {
    name: "todo-ts",
  },
  registrations,
});
