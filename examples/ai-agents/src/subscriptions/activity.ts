import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { TaskRecord } from "../actions/task.actions.ts";

export async function logTaskCreated(ctx: ChimpbaseContext, task: TaskRecord): Promise<void> {
  await ctx.stream.append("agent.activity", "task.created", {
    taskId: task.id,
    agentName: task.agentName,
    prompt: task.prompt.substring(0, 200),
  });
}

export async function logTaskCompleted(ctx: ChimpbaseContext, task: TaskRecord): Promise<void> {
  await ctx.stream.append("agent.activity", "task.completed", {
    taskId: task.id,
    agentName: task.agentName,
  });
}

export async function logTaskFailed(ctx: ChimpbaseContext, task: TaskRecord): Promise<void> {
  await ctx.stream.append("agent.activity", "task.failed", {
    taskId: task.id,
    agentName: task.agentName,
    error: task.error?.substring(0, 500) ?? null,
  });
}

export async function logTaskCancelled(ctx: ChimpbaseContext, task: TaskRecord): Promise<void> {
  await ctx.stream.append("agent.activity", "task.cancelled", {
    taskId: task.id,
    agentName: task.agentName,
  });
}
