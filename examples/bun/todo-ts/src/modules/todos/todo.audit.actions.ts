import { action, type ChimpbaseContext } from "@chimpbase/runtime";
import type {
  TodoAuditRecord,
  TodoEventRecord,
  TodoNotificationRecord,
} from "./todo.types.ts";

const listTodoAuditLog = action({
  async handler(
    ctx: ChimpbaseContext,
  ): Promise<TodoAuditRecord[]> {
    return await ctx.db.query<TodoAuditRecord>(
      `
        SELECT
          id,
          event_name,
          todo_id,
          project_slug,
          title,
          status,
          assignee_email,
          created_at
        FROM todo_audit_log
        ORDER BY id ASC
      `,
    );
  },
  name: "listTodoAuditLog",
});

const listTodoEvents = action({
  async handler(
    ctx: ChimpbaseContext,
  ): Promise<TodoEventRecord[]> {
    return await ctx.db.query<TodoEventRecord>(
      "SELECT id, event_name, payload_json, created_at FROM _chimpbase_events ORDER BY id ASC",
    );
  },
  name: "listTodoEvents",
});

const listTodoNotifications = action({
  async handler(
    ctx: ChimpbaseContext,
  ): Promise<TodoNotificationRecord[]> {
    return await ctx.db.query<TodoNotificationRecord>(
      `
        SELECT
          id,
          queue_name,
          todo_id,
          project_slug,
          title,
          recipient_email,
          sender_email,
          created_at
        FROM todo_notifications
        ORDER BY id ASC
      `,
    );
  },
  name: "listTodoNotifications",
});

export {
  listTodoAuditLog,
  listTodoEvents,
  listTodoNotifications,
};
