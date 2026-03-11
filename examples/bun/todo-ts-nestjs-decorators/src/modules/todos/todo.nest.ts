import { Injectable, Module } from "@nestjs/common";
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

@Injectable()
export class TodoActionsService {
  @Action("listTodos")
  async listTodos(
    ctx: ChimpbaseContext,
    filters: TodoListFilters = {},
  ): Promise<TodoRecord[]> {
    return await listTodos(ctx, filters);
  }

  @Action("createTodo")
  async createTodo(
    ctx: ChimpbaseContext,
    input: CreateTodoInput,
  ): Promise<TodoRecord> {
    return await createTodo(ctx, input);
  }

  @Action("assignTodo")
  async assignTodo(
    ctx: ChimpbaseContext,
    todoId: number,
    assigneeEmail: string,
  ): Promise<TodoRecord> {
    return await assignTodo(ctx, todoId, assigneeEmail);
  }

  @Action("startTodo")
  async startTodo(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoRecord> {
    return await startTodo(ctx, todoId);
  }

  @Action("completeTodo")
  async completeTodo(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoRecord> {
    return await completeTodo(ctx, todoId);
  }

  @Action("getTodoDashboard")
  async getTodoDashboard(
    ctx: ChimpbaseContext,
    projectSlug: string | null,
  ): Promise<TodoDashboard> {
    return await getTodoDashboard(ctx, projectSlug);
  }

  @Action("listTodoAuditLog")
  async listTodoAuditLog(ctx: ChimpbaseContext): Promise<TodoAuditRecord[]> {
    return await listTodoAuditLog(ctx);
  }

  @Action("listTodoEvents")
  async listTodoEvents(ctx: ChimpbaseContext): Promise<TodoEventRecord[]> {
    return await listTodoEvents(ctx);
  }

  @Action("listTodoNotifications")
  async listTodoNotifications(ctx: ChimpbaseContext): Promise<TodoNotificationRecord[]> {
    return await listTodoNotifications(ctx);
  }

  @Action("listWorkspacePreferences")
  async listWorkspacePreferences(ctx: ChimpbaseContext): Promise<TodoPreferenceRecord[]> {
    return await listWorkspacePreferences(ctx);
  }

  @Action("setWorkspacePreference")
  async setWorkspacePreference(
    ctx: ChimpbaseContext,
    key: string,
    value: unknown,
  ): Promise<TodoPreferenceRecord> {
    return await setWorkspacePreference(ctx, key, value);
  }

  @Action("addTodoNote")
  async addTodoNote(
    ctx: ChimpbaseContext,
    input: { body: string; todoId: number },
  ): Promise<TodoNoteRecord> {
    return await addTodoNote(ctx, input);
  }

  @Action("listTodoNotes")
  async listTodoNotes(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoNoteRecord[]> {
    return await listTodoNotes(ctx, todoId);
  }

  @Action("listTodoActivityStream")
  async listTodoActivityStream(
    ctx: ChimpbaseContext,
    input: {
      limit?: number;
      sinceId?: number;
      stream?: string;
    } = {},
  ): Promise<TodoActivityStreamEvent[]> {
    return await listTodoActivityStream(ctx, input);
  }

  @Action("seedDemoWorkspace")
  async seedDemoWorkspace(ctx: ChimpbaseContext): Promise<SeedDemoWorkspaceResult> {
    return await seedDemoWorkspace(ctx);
  }
}

@Injectable()
export class TodoListenersService {
  @Listener("todo.created")
  async auditTodoCreated(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoCreated(ctx, todo);
  }

  @Listener("todo.assigned")
  async auditTodoAssigned(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoAssigned(ctx, todo);
  }

  @Listener("todo.started")
  async auditTodoStarted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoStarted(ctx, todo);
  }

  @Listener("todo.completed")
  async auditTodoCompleted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await auditTodoCompleted(ctx, todo);
  }

  @Listener("todo.completed")
  async enqueueTodoCompletedNotification(
    ctx: ChimpbaseContext,
    todo: TodoRecord,
  ): Promise<void> {
    await enqueueTodoCompletedNotification(ctx, todo);
  }
}

@Injectable()
export class TodoQueuesService {
  @Queue("todo.completed.notify")
  async notifyTodoCompleted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await notifyTodoCompleted(ctx, todo);
  }

  @Queue("todo.completed.notify.dlq", { dlq: false })
  async captureTodoCompletedDlq(
    ctx: ChimpbaseContext,
    envelope: ChimpbaseDlqEnvelope<TodoRecord>,
  ): Promise<void> {
    await captureTodoCompletedDlq(ctx, envelope);
  }
}

@Module({
  exports: [TodoActionsService, TodoListenersService, TodoQueuesService],
  providers: [TodoActionsService, TodoListenersService, TodoQueuesService],
})
export class TodoFeatureModule {}
