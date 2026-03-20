import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { ProjectRecord } from "../projects/project.types.ts";
import type {
  CreateTodoInput,
  SeedDemoWorkspaceResult,
  TodoRecord,
} from "./todo.types.ts";

const seedDemoWorkspace = async (
  ctx: ChimpbaseContext,
): Promise<SeedDemoWorkspaceResult> => {
  const projects = [
    {
      name: "Operations Platform",
      ownerEmail: "ops-lead@chimpbase.dev",
    },
    {
      name: "Revenue Enablement",
      ownerEmail: "growth-ops@chimpbase.dev",
    },
  ];

  const seededProjects: ProjectRecord[] = [];
  for (const projectInput of projects) {
    seededProjects.push(await ctx.action("createProject", projectInput));
  }

  const todos: CreateTodoInput[] = [
    {
      projectSlug: "operations-platform",
      title: "Instrument route latency dashboard",
      description: "Track p95 latency for create, assign and complete flows.",
      priority: "high",
      assigneeEmail: "alice@chimpbase.dev",
      dueDate: "2026-03-15",
    },
    {
      projectSlug: "operations-platform",
      title: "Roll out alert routing runbook",
      description: "Document the handoff procedure for pager escalation.",
      priority: "medium",
      assigneeEmail: "bruno@chimpbase.dev",
      dueDate: "2026-03-19",
    },
    {
      projectSlug: "revenue-enablement",
      title: "Prepare customer onboarding checklist",
      description: "Align onboarding steps with success and sales operations.",
      priority: "critical",
      assigneeEmail: "carol@chimpbase.dev",
      dueDate: "2026-03-12",
    },
  ];

  const createdTodos: TodoRecord[] = [];
  for (const todoInput of todos) {
    const existing = await ctx.db.query<TodoRecord>(
      `
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
        WHERE p.slug = ?1 AND t.title = ?2
        LIMIT 1
      `,
      [todoInput.projectSlug, todoInput.title],
    );

    if (existing.length > 0) {
      createdTodos.push(existing[0]);
      continue;
    }

    createdTodos.push(await ctx.action("createTodo", todoInput));
  }

  return {
    projects: seededProjects,
    todos: createdTodos,
  };
};

export { seedDemoWorkspace };
