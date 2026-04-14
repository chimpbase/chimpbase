import type { ChimpbaseContext, ChimpbaseCronInvocation } from "@chimpbase/runtime";
import type { TaskRecord } from "../actions/task.actions.ts";

const TASKS_COLLECTION = "tasks";
const DEFAULT_MAX_PARALLEL = 3;

export async function dispatchPendingTasks(
  ctx: ChimpbaseContext,
  _invocation: ChimpbaseCronInvocation,
): Promise<void> {
  const maxParallel = await ctx.kv.get<number>("config.maxParallel") ?? DEFAULT_MAX_PARALLEL;
  const running = await ctx.collection.find<TaskRecord>(TASKS_COLLECTION, { status: "running" });
  const available = maxParallel - running.length;

  if (available <= 0) {
    return;
  }

  const pending = await ctx.collection.find<TaskRecord>(TASKS_COLLECTION, { status: "pending" }, { limit: available });

  for (const task of pending) {
    await ctx.queue.enqueue("agent.execute", { taskId: task.id });
    ctx.log.info("task dispatched to worker", { taskId: task.id, agentName: task.agentName });
  }

  if (pending.length > 0) {
    ctx.metric("agent.tasks.dispatched", pending.length);
  }
}
