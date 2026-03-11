import type {
  CreateTodoInput,
  NormalizedCreateTodoInput,
  NormalizedTodoListFilters,
  TodoListFilters,
  TodoPriority,
  TodoStatus,
} from "./todo.types.ts";
import {
  TODO_PRIORITIES,
  TODO_STATUSES,
} from "./todo.types.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAssigneeEmail(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new Error("assigneeEmail must be a valid email");
  }

  return normalized;
}

export function normalizeCreateTodoInput(
  input: CreateTodoInput,
): NormalizedCreateTodoInput {
  const projectSlug = input.projectSlug.trim().toLowerCase();
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";
  const priority = (input.priority?.trim().toLowerCase() ?? "medium") as TodoPriority;
  const dueDate = input.dueDate?.trim() || null;

  if (!projectSlug) {
    throw new Error("projectSlug is required");
  }

  if (title.length < 3) {
    throw new Error("title must have at least 3 characters");
  }

  if (!TODO_PRIORITIES.includes(priority)) {
    throw new Error(`unsupported priority: ${priority}`);
  }

  return {
    projectSlug,
    title,
    description,
    priority,
    assigneeEmail: normalizeAssigneeEmail(input.assigneeEmail ?? null),
    dueDate,
  };
}

export function normalizeTodoFilters(
  input: TodoListFilters = {},
): NormalizedTodoListFilters {
  const projectSlug = input.projectSlug?.trim().toLowerCase() || null;
  const status = (input.status?.trim().toLowerCase() || null) as TodoStatus | null;
  const priority = (input.priority?.trim().toLowerCase() || null) as TodoPriority | null;
  const assigneeEmail = normalizeAssigneeEmail(input.assigneeEmail ?? null);
  const search = input.search?.trim() || null;

  if (status && !TODO_STATUSES.includes(status)) {
    throw new Error(`unsupported status: ${status}`);
  }

  if (priority && !TODO_PRIORITIES.includes(priority)) {
    throw new Error(`unsupported priority: ${priority}`);
  }

  return {
    projectSlug,
    status,
    priority,
    assigneeEmail,
    search,
  };
}

export function assertStatusTransition(
  currentStatus: TodoStatus,
  nextStatus: TodoStatus,
): void {
  const allowedTransitions: Record<TodoStatus, TodoStatus[]> = {
    backlog: ["in_progress", "blocked"],
    in_progress: ["blocked", "done"],
    blocked: ["in_progress", "done"],
    done: [],
  };

  if (!allowedTransitions[currentStatus].includes(nextStatus)) {
    throw new Error(`cannot move todo from ${currentStatus} to ${nextStatus}`);
  }
}
