import {
  Action,
  Subscription,
  Worker,
  type ChimpbaseContext,
  type ChimpbaseDlqEnvelope,
} from "@chimpbase/runtime";

import {
  assertStatusTransition,
  normalizeAssigneeEmail,
  normalizeCreateTodoInput,
  normalizeTodoFilters,
} from "./todo.domain.ts";
import { TodoRepository } from "./todo.repository.ts";
import { ProjectRepository } from "../projects/project.repository.ts";
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
import type { ProjectRecord } from "../projects/project.types.ts";

const DEFAULT_SENDER = "noreply@chimpbase.dev";

export class TodoModule {
  constructor(
    private readonly todos: TodoRepository,
    private readonly projects: ProjectRepository,
  ) {}

  @Action("listTodos")
  async listTodos(
    ctx: ChimpbaseContext,
    filters: TodoListFilters = {},
  ): Promise<TodoRecord[]> {
    return await this.todos.list(ctx.db, normalizeTodoFilters(filters));
  }

  @Action("createTodo")
  async createTodo(
    ctx: ChimpbaseContext,
    input: CreateTodoInput,
  ): Promise<TodoRecord> {
    const normalized = normalizeCreateTodoInput(input);
    const project = await this.projects.requireBySlug(ctx.db, normalized.projectSlug);
    const todo = await this.todos.insert(ctx.db, project.id, normalized);
    ctx.pubsub.publish("todo.created", todo);
    return todo;
  }

  @Action("assignTodo")
  async assignTodo(
    ctx: ChimpbaseContext,
    todoId: number,
    assigneeEmail: string,
  ): Promise<TodoRecord> {
    await this.todos.requireById(ctx.db, todoId);
    const todo = await this.todos.updateAssignee(ctx.db, todoId, normalizeAssigneeEmail(assigneeEmail));
    ctx.pubsub.publish("todo.assigned", todo);
    return todo;
  }

  @Action("startTodo")
  async startTodo(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoRecord> {
    const currentTodo = await this.todos.requireById(ctx.db, todoId);
    assertStatusTransition(currentTodo.status, "in_progress");
    const todo = await this.todos.updateStatus(ctx.db, todoId, "in_progress");
    ctx.pubsub.publish("todo.started", todo);
    return todo;
  }

  @Action("completeTodo")
  async completeTodo(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoRecord> {
    const currentTodo = await this.todos.requireById(ctx.db, todoId);
    assertStatusTransition(currentTodo.status, "done");
    const todo = await this.todos.updateStatus(ctx.db, todoId, "done");
    ctx.pubsub.publish("todo.completed", todo);
    return todo;
  }

  @Action("getTodoDashboard")
  async getTodoDashboard(
    ctx: ChimpbaseContext,
    projectSlug: string | null,
  ): Promise<TodoDashboard> {
    const normalizedProjectSlug = projectSlug?.trim().toLowerCase() || null;
    return await this.todos.getDashboard(ctx.db, normalizedProjectSlug);
  }

  @Action("listTodoAuditLog")
  async listTodoAuditLog(ctx: ChimpbaseContext): Promise<TodoAuditRecord[]> {
    return await ctx.db.query<TodoAuditRecord>(
      `
        SELECT
          id, event_name, todo_id, project_slug,
          title, status, assignee_email, created_at
        FROM todo_audit_log
        ORDER BY id ASC
      `,
    );
  }

  @Action("listTodoEvents")
  async listTodoEvents(ctx: ChimpbaseContext): Promise<TodoEventRecord[]> {
    return await ctx.db.query<TodoEventRecord>(
      "SELECT id, event_name, payload_json, created_at FROM _chimpbase_events ORDER BY id ASC",
    );
  }

  @Action("listTodoNotifications")
  async listTodoNotifications(ctx: ChimpbaseContext): Promise<TodoNotificationRecord[]> {
    return await ctx.db.query<TodoNotificationRecord>(
      `
        SELECT
          id, queue_name, todo_id, project_slug,
          title, recipient_email, sender_email, created_at
        FROM todo_notifications
        ORDER BY id ASC
      `,
    );
  }

  @Subscription("todo.created")
  async auditTodoCreated(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await this.insertAuditEntry(ctx, "todo.created", todo);
  }

  @Subscription("todo.assigned")
  async auditTodoAssigned(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await this.insertAuditEntry(ctx, "todo.assigned", todo);
  }

  @Subscription("todo.started")
  async auditTodoStarted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await this.insertAuditEntry(ctx, "todo.started", todo);
  }

  @Subscription("todo.completed")
  async auditTodoCompleted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await this.insertAuditEntry(ctx, "todo.completed", todo);
  }

  @Subscription("todo.completed")
  async enqueueTodoCompletedNotification(
    ctx: ChimpbaseContext,
    todo: TodoRecord,
  ): Promise<void> {
    await ctx.queue.enqueue("todo.completed.notify", todo);
  }

  @Action("listWorkspacePreferences")
  async listWorkspacePreferences(
    ctx: ChimpbaseContext,
  ): Promise<TodoPreferenceRecord[]> {
    return await Promise.all(
      (await ctx.kv.list({ prefix: "workspace." })).map(async (key) => ({
        key,
        value: await ctx.kv.get(key),
      })),
    );
  }

  @Action("setWorkspacePreference")
  async setWorkspacePreference(
    ctx: ChimpbaseContext,
    key: string,
    value: unknown,
  ): Promise<TodoPreferenceRecord> {
    const normalizedKey = `workspace.${key.trim()}`;
    await ctx.kv.set(normalizedKey, value);
    return {
      key: normalizedKey,
      value: await ctx.kv.get(normalizedKey),
    };
  }

  @Action("addTodoNote")
  async addTodoNote(
    ctx: ChimpbaseContext,
    input: { body: string; todoId: number },
  ): Promise<TodoNoteRecord> {
    const noteId = await ctx.collection.insert("todo_notes", {
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
      todoId: input.todoId,
    });
    const note = await ctx.collection.findOne<TodoNoteRecord>("todo_notes", { id: noteId });
    if (!note) {
      throw new Error("failed to load inserted todo note");
    }

    return note;
  }

  @Action("listTodoNotes")
  async listTodoNotes(
    ctx: ChimpbaseContext,
    todoId: number,
  ): Promise<TodoNoteRecord[]> {
    return await ctx.collection.find<TodoNoteRecord>("todo_notes", { todoId }, { limit: 100 });
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
    return await ctx.stream.read<TodoActivityStreamEvent["payload"]>(
      input.stream ?? "todo.activity",
      {
        limit: input.limit ?? 100,
        sinceId: input.sinceId ?? 0,
      },
    ) as TodoActivityStreamEvent[];
  }

  @Worker("todo.completed.notify")
  async notifyTodoCompleted(ctx: ChimpbaseContext, todo: TodoRecord): Promise<void> {
    await ctx.trace("todo.completed.notify", async (span) => {
      const senderEmail = ctx.secret("TODO_NOTIFIER_SENDER") ?? DEFAULT_SENDER;
      span.setAttribute("queue", "todo.completed.notify");
      span.setAttribute("todo.id", todo.id);
      span.setAttribute("project.slug", todo.project_slug);

      ctx.log.info("processing todo completion notification", {
        queue: "todo.completed.notify",
        senderEmail,
        todoId: todo.id,
      });
      ctx.metric("todo.notifications.delivered", 1, {
        queue: "todo.completed.notify",
        projectSlug: todo.project_slug,
      });

      await ctx.db.query(
        `
          INSERT INTO todo_notifications (
            queue_name, todo_id, project_slug,
            title, recipient_email, sender_email
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `,
        [
          "todo.completed.notify",
          todo.id,
          todo.project_slug,
          todo.title,
          todo.assignee_email,
          senderEmail,
        ],
      );
    }, {
      queue: "todo.completed.notify",
    });
  }

  @Worker("todo.completed.notify.dlq", { dlq: false })
  async captureTodoCompletedDlq(
    ctx: ChimpbaseContext,
    envelope: ChimpbaseDlqEnvelope<TodoRecord>,
  ): Promise<void> {
    ctx.log.error("todo completion notification moved to DLQ", {
      attempts: envelope.attempts,
      queue: envelope.queue,
      todoId: envelope.payload.id,
    });
  }

  @Action("seedDemoWorkspace")
  async seedDemoWorkspace(ctx: ChimpbaseContext): Promise<SeedDemoWorkspaceResult> {
    const projects = [
      { name: "Operations Platform", ownerEmail: "ops-lead@chimpbase.dev" },
      { name: "Revenue Enablement", ownerEmail: "growth-ops@chimpbase.dev" },
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
            t.id, t.project_id, p.slug AS project_slug, p.name AS project_name,
            t.title, t.description, t.status, t.priority,
            t.assignee_email, t.due_date, t.created_at, t.updated_at, t.completed_at
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

    return { projects: seededProjects, todos: createdTodos };
  }

  private async insertAuditEntry(
    ctx: ChimpbaseContext,
    eventName: string,
    todo: TodoRecord,
  ): Promise<void> {
    await ctx.db.query(
      `
        INSERT INTO todo_audit_log (
          event_name, todo_id, project_slug,
          title, status, assignee_email
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
      [eventName, todo.id, todo.project_slug, todo.title, todo.status, todo.assignee_email],
    );

    await ctx.stream.append("todo.activity", eventName, {
      assigneeEmail: todo.assignee_email,
      projectSlug: todo.project_slug,
      status: todo.status,
      title: todo.title,
      todoId: todo.id,
    });
  }
}
