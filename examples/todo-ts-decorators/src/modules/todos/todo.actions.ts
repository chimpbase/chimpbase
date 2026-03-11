import type { ChimpbaseContext } from "@chimpbase/runtime";
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

const listTodos = async (
  ctx: ChimpbaseContext,
  filters: TodoListFilters = {},
): Promise<TodoRecord[]> => {
  return await listTodosFromRepository(ctx, normalizeTodoFilters(filters));
};

const createTodo = async (
  ctx: ChimpbaseContext,
  input: CreateTodoInput,
): Promise<TodoRecord> => {
  const normalized = normalizeCreateTodoInput(input);
  const project = await requireProjectBySlug(ctx, normalized.projectSlug);
  const todo = await insertTodo(ctx, project.id, normalized);
  ctx.emit("todo.created", todo);
  return todo;
};

const assignTodo = async (
  ctx: ChimpbaseContext,
  todoId: number,
  assigneeEmail: string,
): Promise<TodoRecord> => {
  await requireTodoById(ctx, todoId);
  const todo = await updateTodoAssignee(ctx, todoId, normalizeAssigneeEmail(assigneeEmail));
  ctx.emit("todo.assigned", todo);
  return todo;
};

const startTodo = async (
  ctx: ChimpbaseContext,
  todoId: number,
): Promise<TodoRecord> => {
  const currentTodo = await requireTodoById(ctx, todoId);
  assertStatusTransition(currentTodo.status, "in_progress");
  const todo = await updateTodoStatus(ctx, todoId, "in_progress");
  ctx.emit("todo.started", todo);
  return todo;
};

const completeTodo = async (
  ctx: ChimpbaseContext,
  todoId: number,
): Promise<TodoRecord> => {
  const currentTodo = await requireTodoById(ctx, todoId);
  assertStatusTransition(currentTodo.status, "done");
  const todo = await updateTodoStatus(ctx, todoId, "done");
  ctx.emit("todo.completed", todo);
  return todo;
};

const getTodoDashboard = async (
  ctx: ChimpbaseContext,
  projectSlug: string | null,
): Promise<TodoDashboard> => {
  const normalizedProjectSlug = projectSlug?.trim().toLowerCase() || null;
  return await getTodoDashboardFromRepository(ctx, normalizedProjectSlug);
};

export {
  assignTodo,
  completeTodo,
  createTodo,
  getTodoDashboard,
  listTodos,
  startTodo,
};
