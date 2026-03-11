import type {
  ChimpbaseContext,
  ChimpbaseDlqEnvelope,
} from "@chimpbase/runtime";
import type { TodoRecord } from "./todo.types.ts";

const DEFAULT_SENDER = "noreply@chimpbase.dev";

const notifyTodoCompleted = async (
  ctx: ChimpbaseContext,
  todo: TodoRecord,
): Promise<void> => {
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

    await ctx.query(
      `
        INSERT INTO todo_notifications (
          queue_name,
          todo_id,
          project_slug,
          title,
          recipient_email,
          sender_email
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
};

const captureTodoCompletedDlq = async (
  ctx: ChimpbaseContext,
  envelope: ChimpbaseDlqEnvelope<TodoRecord>,
): Promise<void> => {
  ctx.log.error("todo completion notification moved to DLQ", {
    attempts: envelope.attempts,
    queue: envelope.queue,
    todoId: envelope.payload.id,
  });
};

export {
  captureTodoCompletedDlq,
  notifyTodoCompleted,
};
