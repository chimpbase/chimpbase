export const TODO_STATUSES = ["backlog", "in_progress", "blocked", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export interface TodoRecord {
  id: number;
  project_id: number;
  project_slug: string;
  project_name: string;
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  assignee_email: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateTodoInput {
  projectSlug: string;
  title: string;
  description?: string;
  priority?: string;
  assigneeEmail?: string | null;
  dueDate?: string | null;
}

export interface NormalizedCreateTodoInput {
  projectSlug: string;
  title: string;
  description: string;
  priority: TodoPriority;
  assigneeEmail: string | null;
  dueDate: string | null;
}

export interface TodoListFilters {
  projectSlug?: string;
  status?: string;
  priority?: string;
  assigneeEmail?: string;
  search?: string;
}

export interface NormalizedTodoListFilters {
  projectSlug: string | null;
  status: TodoStatus | null;
  priority: TodoPriority | null;
  assigneeEmail: string | null;
  search: string | null;
}

export interface TodoDashboard {
  total: number;
  backlog: number;
  in_progress: number;
  blocked: number;
  done: number;
  assigned: number;
  overdue: number;
}

export interface TodoAuditRecord {
  id: number;
  event_name: string;
  todo_id: number;
  project_slug: string;
  title: string;
  status: TodoStatus;
  assignee_email: string | null;
  created_at: string;
}

export interface TodoEventRecord {
  id: number;
  event_name: string;
  payload_json: string;
  created_at: string;
}

export interface TodoNotificationRecord {
  id: number;
  queue_name: string;
  todo_id: number;
  project_slug: string;
  title: string;
  recipient_email: string | null;
  sender_email: string;
  created_at: string;
}

export interface TodoBacklogSnapshotRecord {
  capturedAt: string;
  id: string;
  schedule: string;
  summary: TodoDashboard;
}

export interface TodoPreferenceRecord {
  key: string;
  value: unknown;
}

export interface TodoNoteRecord {
  body: string;
  createdAt: string;
  id: string;
  todoId: number;
}

export interface TodoActivityStreamEvent {
  createdAt: string;
  event: string;
  id: number;
  payload: {
    assigneeEmail: string | null;
    projectSlug: string;
    status: TodoStatus;
    title: string;
    todoId: number;
  };
  stream: string;
}

export interface SeedDemoWorkspaceResult {
  projects: unknown[];
  todos: TodoRecord[];
}
