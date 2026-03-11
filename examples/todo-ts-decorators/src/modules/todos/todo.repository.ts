import type { ChimpbaseContext } from "@chimpbase/runtime";
import type {
  NormalizedCreateTodoInput,
  NormalizedTodoListFilters,
  TodoDashboard,
  TodoRecord,
  TodoStatus,
} from "./todo.types.ts";

const TODO_SELECT = `
  SELECT
    t.id,
    t.project_id,
    p.slug AS project_slug,
    p.name AS project_name,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.assignee_email,
    t.due_date,
    t.created_at,
    t.updated_at,
    t.completed_at
  FROM todo_items t
  INNER JOIN projects p ON p.id = t.project_id
`;

export function listTodos(
  ctx: ChimpbaseContext,
  filters: NormalizedTodoListFilters,
): Promise<TodoRecord[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.projectSlug) {
    clauses.push(`p.slug = ?${params.length + 1}`);
    params.push(filters.projectSlug);
  }

  if (filters.status) {
    clauses.push(`t.status = ?${params.length + 1}`);
    params.push(filters.status);
  }

  if (filters.priority) {
    clauses.push(`t.priority = ?${params.length + 1}`);
    params.push(filters.priority);
  }

  if (filters.assigneeEmail) {
    clauses.push(`t.assignee_email = ?${params.length + 1}`);
    params.push(filters.assigneeEmail);
  }

  if (filters.search) {
    clauses.push(`(t.title LIKE ?${params.length + 1} OR t.description LIKE ?${params.length + 1})`);
    params.push(`%${filters.search}%`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  return ctx.query<TodoRecord>(
    `${TODO_SELECT} ${whereClause} ORDER BY p.name ASC, t.priority DESC, t.id ASC`,
    params,
  );
}

export async function findTodoById(
  ctx: ChimpbaseContext,
  todoId: number,
): Promise<TodoRecord | null> {
  const [todo] = await ctx.query<TodoRecord>(
    `${TODO_SELECT} WHERE t.id = ?1 LIMIT 1`,
    [todoId],
  );
  return todo ?? null;
}

export async function requireTodoById(
  ctx: ChimpbaseContext,
  todoId: number,
): Promise<TodoRecord> {
  const todo = await findTodoById(ctx, todoId);
  if (!todo) {
    throw new Error(`todo not found: ${todoId}`);
  }

  return todo;
}

export async function insertTodo(
  ctx: ChimpbaseContext,
  projectId: number,
  input: NormalizedCreateTodoInput,
): Promise<TodoRecord> {
  const [inserted] = await ctx.query<{ id: number }>(
    `
      INSERT INTO todo_items (
        project_id,
        title,
        description,
        priority,
        assignee_email,
        due_date
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      RETURNING id
    `,
    [
      projectId,
      input.title,
      input.description,
      input.priority,
      input.assigneeEmail,
      input.dueDate,
    ],
  );

  const [todo] = inserted
    ? await ctx.query<TodoRecord>(`${TODO_SELECT} WHERE t.id = ?1 LIMIT 1`, [inserted.id])
    : [];

  if (!todo) {
    throw new Error("failed to load inserted todo");
  }

  return todo;
}

export async function updateTodoAssignee(
  ctx: ChimpbaseContext,
  todoId: number,
  assigneeEmail: string | null,
): Promise<TodoRecord> {
  await ctx.query(
    `
      UPDATE todo_items
      SET assignee_email = ?1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?2
    `,
    [assigneeEmail, todoId],
  );

  return await requireTodoById(ctx, todoId);
}

export async function updateTodoStatus(
  ctx: ChimpbaseContext,
  todoId: number,
  status: TodoStatus,
): Promise<TodoRecord> {
  const completedAtClause = status === "done"
    ? "CURRENT_TIMESTAMP"
    : "NULL";

  await ctx.query(
    `
      UPDATE todo_items
      SET
        status = ?1,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = ${completedAtClause}
      WHERE id = ?2
    `,
    [status, todoId],
  );

  return await requireTodoById(ctx, todoId);
}

export async function getTodoDashboard(
  ctx: ChimpbaseContext,
  projectSlug: string | null,
): Promise<TodoDashboard> {
  const params = projectSlug ? [projectSlug] : [];
  const filter = projectSlug ? "WHERE p.slug = ?1" : "";
  const [dashboard] = await ctx.query<TodoDashboard>(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN t.assignee_email IS NOT NULL THEN 1 ELSE 0 END) AS assigned,
        SUM(
          CASE
            WHEN t.due_date IS NOT NULL
             AND t.status <> 'done'
             AND DATE(t.due_date) < CURRENT_DATE
            THEN 1
            ELSE 0
          END
        ) AS overdue
      FROM todo_items t
      INNER JOIN projects p ON p.id = t.project_id
      ${filter}
    `,
    params,
  );

  return dashboard ?? {
    total: 0,
    backlog: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    assigned: 0,
    overdue: 0,
  };
}
