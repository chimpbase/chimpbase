import {
  Action,
  Listener,
  Queue,
  type ChimpbaseContext,
  type ChimpbaseDlqEnvelope,
} from "@chimpbase/runtime";

import {
  assignTodo,
  completeTodo,
  createTodo,
  getTodoDashboard,
  listTodos,
  startTodo,
} from "./todo.actions.ts";
import {
  listTodoAuditLog,
  listTodoEvents,
  listTodoNotifications,
} from "./todo.audit.actions.ts";
import {
  auditTodoAssigned,
  auditTodoCompleted,
  auditTodoCreated,
  auditTodoStarted,
  enqueueTodoCompletedNotification,
} from "./todo.listeners.ts";
import {
  addTodoNote,
  listTodoActivityStream,
  listTodoNotes,
  listWorkspacePreferences,
  setWorkspacePreference,
} from "./todo.platform.actions.ts";
import {
  captureTodoCompletedDlq,
  notifyTodoCompleted,
} from "./todo.queues.ts";
import { seedDemoWorkspace } from "./todo.seed.actions.ts";
import type {
  CreateTodoInput,
  SeedDemoWorkspaceResult,
  TodoActivityStreamEvent,
  TodoAuditRecord,
  TodoDashboard,
  TodoEventRecord,
  TodoListFilters,
  TodoNoteRecord,
  TodoNotificationRecord,
  TodoPreferenceRecord,
  TodoRecord,
} from "./todo.types.ts";

export class TodoModule {
  @Action("listTodos")
  static async listTodos(
    ctx: ChimpbaseContext,
    filters: TodoListFilters = {},
  ): Promise<TodoRecord[]> {
    return await listTodos(ctx, filters);
  }

  @Action("createTodo")
  static async createTodo(
    ctx: ChimpbaseContext,
    input: CreateTodoInput,
  ): Promise<TodoRecord> {
    return await createTodo(ctx, input);
  }

  @Action("assignTodo")
  static async assignTodo(
    ctx: ChimpbaseContext,
    todoId: number,
    assigneeEmail: string,
  ): Promise<TodoRecord> {
    return await assignTodo(ctx, todoId, assigneeEmail);
  }

  @Action("startTodo")
  static async startTodo(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoRecord> {
    return await startTodo(ctx, todoId);
  }

  @Action("completeTodo")
  static async completeTodo(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoRecord> {
    return await completeTodo(ctx, todoId);
  }

  @Action("getTodoDashboard")
  static async getTodoDashboard(
    ctx: ChimpbaseContext,
    projectSlug: string | null,
  ): Promise<TodoDashboard> {
    return await getTodoDashboard(ctx, projectSlug);
  }

  @Action("listTodoAuditLog")
  static async listTodoAuditLog(ctx: ChimpbaseContext): Promise<TodoAuditRecord[]> {
    return await listTodoAuditLog(ctx);
  }

  @Action("listTodoEvents")
  static async listTodoEvents(ctx: ChimpbaseContext): Promise<TodoEventRecord[]> {
    return await listTodoEvents(ctx);
  }

  @Action("listTodoNotifications")
  static async listTodoNotifications(ctx: ChimpbaseContext): Promise<TodoNotificationRecord[]> {
    return await listTodoNotifications(ctx);
  }

  @Listener("todo.created")
  static async auditTodoCreated(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoCreated(ctx, todo);
  }

  @Listener("todo.assigned")
  static async auditTodoAssigned(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoAssigned(ctx, todo);
  }

  @Listener("todo.started")
  static async auditTodoStarted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoStarted(ctx, todo);
  }

  @Listener("todo.completed")
  static async auditTodoCompleted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoCompleted(ctx, todo);
  }

  @Listener("todo.completed")
  static async enqueueTodoCompletedNotification(
    ctx: ChimpbaseContext,
    todo: TodoRecord,
  ): Promise<void> {
    await enqueueTodoCompletedNotification(ctx, todo);
  }

  @Action("listWorkspacePreferences")
  static async listWorkspacePreferences(
    ctx: ChimpbaseContext,
  ): Promise<TodoPreferenceRecord[]> {
    return await listWorkspacePreferences(ctx);
  }

  @Action("setWorkspacePreference")
  static async setWorkspacePreference(
    ctx: ChimpbaseContext,
    key: string,
    value: unknown,
  ): Promise<TodoPreferenceRecord> {
    return await setWorkspacePreference(ctx, key, value);
  }

  @Action("addTodoNote")
  static async addTodoNote(
    ctx: ChimpbaseContext,
    input: { body: string; todoId: number },
  ): Promise<TodoNoteRecord> {
    return await addTodoNote(ctx, input);
  }

  @Action("listTodoNotes")
  static async listTodoNotes(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoNoteRecord[]> {
    return await listTodoNotes(ctx, todoId);
  }

  @Action("listTodoActivityStream")
  static async listTodoActivityStream(
    ctx: ChimpbaseContext,
    input: {
      limit?: number;
      sinceId?: number;
      stream?: string;
    } = {},
  ): Promise<TodoActivityStreamEvent[]> {
    return await listTodoActivityStream(ctx, input);
  }

  @Queue("todo.completed.notify")
  static async notifyTodoCompleted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await notifyTodoCompleted(ctx, todo);
  }

  @Queue("todo.completed.notify.dlq", { dlq: false })
  static async captureTodoCompletedDlq(
    ctx: ChimpbaseContext,
    envelope: ChimpbaseDlqEnvelope<TodoRecord>,
  ): Promise<void> {
    await captureTodoCompletedDlq(ctx, envelope);
  }

  @Action("seedDemoWorkspace")
  static async seedDemoWorkspace(ctx: ChimpbaseContext): Promise<SeedDemoWorkspaceResult> {
    return await seedDemoWorkspace(ctx);
  }
}
