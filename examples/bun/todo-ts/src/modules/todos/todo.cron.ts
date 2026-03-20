import type {
  ChimpbaseContext,
  ChimpbaseCronInvocation,
} from "@chimpbase/runtime";
import { action } from "@chimpbase/runtime";
import type {
  TodoBacklogSnapshotRecord,
  TodoDashboard,
} from "./todo.types.ts";

const captureTodoBacklogSnapshot = async (
  ctx: ChimpbaseContext,
  invocation: ChimpbaseCronInvocation,
): Promise<void> => {
  const [summary] = await ctx.db.query<TodoDashboard>(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN assignee_email IS NOT NULL THEN 1 ELSE 0 END) AS assigned,
        SUM(
          CASE
            WHEN due_date IS NOT NULL
              AND status != 'done'
              AND DATE(due_date) < DATE('now')
            THEN 1
            ELSE 0
          END
        ) AS overdue
      FROM todo_items
    `,
  );

  const snapshot = {
    capturedAt: invocation.fireAt,
    schedule: invocation.name,
    summary,
  };

  await ctx.collection.insert("todo_backlog_snapshots", snapshot);
  await ctx.stream.append("todo.ops", "todo.backlog.snapshot.captured", {
    capturedAt: invocation.fireAt,
    overdue: summary.overdue,
    schedule: invocation.name,
    total: summary.total,
  });

  ctx.log.info("captured todo backlog snapshot", {
    overdue: summary.overdue,
    schedule: invocation.name,
    total: summary.total,
  });
};

const listTodoBacklogSnapshots = action({
  async handler(
    ctx: ChimpbaseContext,
  ): Promise<TodoBacklogSnapshotRecord[]> {
    return await ctx.collection.find<TodoBacklogSnapshotRecord>(
      "todo_backlog_snapshots",
      {},
      { limit: 50 },
    );
  },
  name: "listTodoBacklogSnapshots",
});

export {
  captureTodoBacklogSnapshot,
  listTodoBacklogSnapshots,
};
