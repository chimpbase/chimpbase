import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { TodoRecord } from "./todo.types.ts";

function registerTodoAuditSubscription(eventName: string) {
  return async (
    ctx: ChimpbaseContext,
    todo: TodoRecord,
  ): Promise<void> => {
    await ctx.query(
      `
        INSERT INTO todo_audit_log (
          event_name,
          todo_id,
          project_slug,
          title,
          status,
          assignee_email
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
      [
        eventName,
        todo.id,
        todo.project_slug,
        todo.title,
        todo.status,
        todo.assignee_email,
      ],
    );

    await ctx.stream.append("todo.activity", eventName, {
      assigneeEmail: todo.assignee_email,
      projectSlug: todo.project_slug,
      status: todo.status,
      title: todo.title,
      todoId: todo.id,
    });
  };
}

const auditTodoCreated = registerTodoAuditSubscription("todo.created");
const auditTodoAssigned = registerTodoAuditSubscription("todo.assigned");
const auditTodoStarted = registerTodoAuditSubscription("todo.started");
const auditTodoCompleted = registerTodoAuditSubscription("todo.completed");

const enqueueTodoCompletedNotification = async (
  ctx: ChimpbaseContext,
  todo: TodoRecord,
): Promise<void> => {
  await ctx.queue.enqueue("todo.completed.notify", todo);
};

export {
  auditTodoAssigned,
  auditTodoCompleted,
  auditTodoCreated,
  auditTodoStarted,
  enqueueTodoCompletedNotification,
};
