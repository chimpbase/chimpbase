import { action, type ChimpbaseContext } from "@chimpbase/runtime";
import type { AgentRecord } from "./agent.actions.ts";

const TASKS_COLLECTION = "tasks";
const AGENTS_COLLECTION = "agents";

export interface TaskRecord {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  prompt: string;
  output: string | null;
  error: string | null;
  containerId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const createTask = action(
  "createTask",
  async (
    ctx: ChimpbaseContext,
    input: { agentId: string; prompt?: string },
  ) => {
    const agent = await ctx.collection.findOne<AgentRecord>(AGENTS_COLLECTION, { id: input.agentId });
    if (!agent) throw new Error("agent not found");

    const id = await ctx.collection.insert(TASKS_COLLECTION, {
      agentId: agent.id,
      agentName: agent.name,
      status: "pending",
      prompt: input.prompt ?? agent.prompt,
      output: null,
      error: null,
      containerId: null,
      startedAt: null,
      completedAt: null,
      createdAt: nowIso(),
    });

    const task = await ctx.collection.findOne<TaskRecord>(TASKS_COLLECTION, { id });
    ctx.pubsub.publish("task.created", task);
    ctx.log.info("task created", { taskId: id, agentId: agent.id, agentName: agent.name });
    ctx.metric("agent.tasks.created", 1, { agentName: agent.name });
    return task;
  },
);

export const listTasks = action(
  "listTasks",
  async (ctx: ChimpbaseContext, filters?: { status?: string; agentId?: string }) => {
    const filter: Record<string, unknown> = {};
    if (filters?.status) filter.status = filters.status;
    if (filters?.agentId) filter.agentId = filters.agentId;
    return await ctx.collection.find<TaskRecord>(TASKS_COLLECTION, filter);
  },
);

export const getTask = action("getTask", async (ctx: ChimpbaseContext, id: string) => {
  return await ctx.collection.findOne<TaskRecord>(TASKS_COLLECTION, { id });
});

export const cancelTask = action("cancelTask", async (ctx: ChimpbaseContext, id: string) => {
  const task = await ctx.collection.findOne<TaskRecord>(TASKS_COLLECTION, { id });
  if (!task) return null;

  if (task.status !== "pending" && task.status !== "running") {
    return task;
  }

  if (task.status === "running" && task.containerId) {
    try {
      Bun.spawnSync(["docker", "kill", task.containerId], { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      // container may have already exited
    }
  }

  await ctx.collection.update(TASKS_COLLECTION, { id }, {
    status: "cancelled",
    completedAt: nowIso(),
  });

  const cancelled = await ctx.collection.findOne<TaskRecord>(TASKS_COLLECTION, { id });
  ctx.pubsub.publish("task.cancelled", cancelled);
  ctx.log.info("task cancelled", { taskId: id, agentName: task.agentName });
  return cancelled;
});

export const updateTaskStatus = action(
  "updateTaskStatus",
  async (
    ctx: ChimpbaseContext,
    input: {
      taskId: string;
      status: string;
      output?: string;
      error?: string;
      containerId?: string;
    },
  ) => {
    const patch: Record<string, unknown> = { status: input.status };
    if (input.output !== undefined) patch.output = input.output;
    if (input.error !== undefined) patch.error = input.error;
    if (input.containerId !== undefined) patch.containerId = input.containerId;
    if (input.status === "running") patch.startedAt = nowIso();
    if (input.status === "completed" || input.status === "failed") patch.completedAt = nowIso();

    await ctx.collection.update(TASKS_COLLECTION, { id: input.taskId }, patch);
    return await ctx.collection.findOne<TaskRecord>(TASKS_COLLECTION, { id: input.taskId });
  },
);
