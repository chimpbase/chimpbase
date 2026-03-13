import { action, type ChimpbaseContext, v } from "@chimpbase/runtime";
import {
  normalizeAssigneeEmail,
  normalizeCreateTodoInput,
  normalizeTodoFilters,
  assertStatusTransition,
} from "./todo.domain.ts";
import {
  getTodoDashboard as getTodoDashboardFromRepository,
  insertTodo,
  listTodos as listTodosFromRepository,
  requireTodoById,
  updateTodoAssignee,
  updateTodoStatus,
} from "./todo.repository.ts";
import { requireProjectBySlug } from "../projects/project.repository.ts";
import type {
  CreateTodoInput,
  TodoDashboard,
  TodoListFilters,
  TodoRecord,
} from "./todo.types.ts";

const listTodos = action({
  args: v.object({
    assigneeEmail: v.optional(v.string()),
    priority: v.optional(v.string()),
    projectSlug: v.optional(v.string()),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    filters: TodoListFilters,
  ): Promise<TodoRecord[]> {
    return await listTodosFromRepository(ctx, normalizeTodoFilters(filters));
  },
  name: "listTodos",
});

const createTodo = action({
  args: v.object({
    assigneeEmail: v.optional(v.union(v.string(), v.null())),
    description: v.optional(v.string()),
    dueDate: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(v.string()),
    projectSlug: v.string(),
    title: v.string(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: CreateTodoInput,
  ): Promise<TodoRecord> {
    const normalized = normalizeCreateTodoInput(input);
    const project = await requireProjectBySlug(ctx, normalized.projectSlug);
    const todo = await insertTodo(ctx, project.id, normalized);
    ctx.pubsub.publish("todo.created", todo);
    return todo;
  },
  name: "createTodo",
});

const assignTodo = action({
  args: v.object({
    assigneeEmail: v.string(),
    todoId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { assigneeEmail: string; todoId: number },
  ): Promise<TodoRecord> {
    await requireTodoById(ctx, input.todoId);
    const todo = await updateTodoAssignee(ctx, input.todoId, normalizeAssigneeEmail(input.assigneeEmail));
    ctx.pubsub.publish("todo.assigned", todo);
    return todo;
  },
  name: "assignTodo",
});

const startTodo = action({
  args: v.object({
    todoId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { todoId: number },
  ): Promise<TodoRecord> {
    const currentTodo = await requireTodoById(ctx, input.todoId);
    assertStatusTransition(currentTodo.status, "in_progress");
    const todo = await updateTodoStatus(ctx, input.todoId, "in_progress");
    ctx.pubsub.publish("todo.started", todo);
    return todo;
  },
  name: "startTodo",
});

const completeTodo = action({
  args: v.object({
    todoId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { todoId: number },
  ): Promise<TodoRecord> {
    const currentTodo = await requireTodoById(ctx, input.todoId);
    assertStatusTransition(currentTodo.status, "done");
    const todo = await updateTodoStatus(ctx, input.todoId, "done");
    ctx.pubsub.publish("todo.completed", todo);
    return todo;
  },
  name: "completeTodo",
});

const getTodoDashboard = action({
  args: v.object({
    projectSlug: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { projectSlug?: string },
  ): Promise<TodoDashboard> {
    const normalizedProjectSlug = input.projectSlug?.trim().toLowerCase() || null;
    return await getTodoDashboardFromRepository(ctx, normalizedProjectSlug);
  },
  name: "getTodoDashboard",
});

export {
  assignTodo,
  completeTodo,
  createTodo,
  getTodoDashboard,
  listTodos,
  startTodo,
};
