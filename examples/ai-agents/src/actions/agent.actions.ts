import { action, type ChimpbaseContext } from "@chimpbase/runtime";

const AGENTS_COLLECTION = "agents";

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  dockerImage: string;
  prompt: string;
  repoUrl: string | null;
  schedule: string | null;
  maxParallel: number;
  env: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const createAgent = action(
  "createAgent",
  async (
    ctx: ChimpbaseContext,
    input: {
      name: string;
      description?: string;
      dockerImage: string;
      prompt: string;
      repoUrl?: string;
      schedule?: string;
      maxParallel?: number;
      env?: Record<string, string>;
      active?: boolean;
    },
  ) => {
    const now = nowIso();
    const id = await ctx.collection.insert(AGENTS_COLLECTION, {
      name: input.name,
      description: input.description ?? "",
      dockerImage: input.dockerImage,
      prompt: input.prompt,
      repoUrl: input.repoUrl ?? null,
      schedule: input.schedule ?? null,
      maxParallel: input.maxParallel ?? 1,
      env: JSON.stringify(input.env ?? {}),
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    });

    const agent = await ctx.collection.findOne<AgentRecord>(AGENTS_COLLECTION, { id });
    ctx.pubsub.publish("agent.created", agent);
    ctx.log.info("agent created", { agentId: id, name: input.name });
    ctx.metric("agent.created", 1, { name: input.name });
    return agent;
  },
);

export const listAgents = action("listAgents", async (ctx: ChimpbaseContext) => {
  return await ctx.collection.find<AgentRecord>(AGENTS_COLLECTION, {});
});

export const getAgent = action("getAgent", async (ctx: ChimpbaseContext, id: string) => {
  return await ctx.collection.findOne<AgentRecord>(AGENTS_COLLECTION, { id });
});

export const updateAgent = action(
  "updateAgent",
  async (
    ctx: ChimpbaseContext,
    input: {
      id: string;
      name?: string;
      description?: string;
      dockerImage?: string;
      prompt?: string;
      repoUrl?: string | null;
      schedule?: string | null;
      maxParallel?: number;
      env?: Record<string, string>;
      active?: boolean;
    },
  ) => {
    const existing = await ctx.collection.findOne<AgentRecord>(AGENTS_COLLECTION, { id: input.id });
    if (!existing) return null;

    const patch: Record<string, unknown> = { updatedAt: nowIso() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.dockerImage !== undefined) patch.dockerImage = input.dockerImage;
    if (input.prompt !== undefined) patch.prompt = input.prompt;
    if (input.repoUrl !== undefined) patch.repoUrl = input.repoUrl;
    if (input.schedule !== undefined) patch.schedule = input.schedule;
    if (input.maxParallel !== undefined) patch.maxParallel = input.maxParallel;
    if (input.env !== undefined) patch.env = JSON.stringify(input.env);
    if (input.active !== undefined) patch.active = input.active;

    await ctx.collection.update(AGENTS_COLLECTION, { id: input.id }, patch);
    const updated = await ctx.collection.findOne<AgentRecord>(AGENTS_COLLECTION, { id: input.id });
    ctx.pubsub.publish("agent.updated", updated);
    ctx.log.info("agent updated", { agentId: input.id });
    return updated;
  },
);

export const deleteAgent = action("deleteAgent", async (ctx: ChimpbaseContext, id: string) => {
  const deleted = await ctx.collection.delete(AGENTS_COLLECTION, { id });
  if (deleted > 0) {
    ctx.pubsub.publish("agent.deleted", { agentId: id });
    ctx.log.info("agent deleted", { agentId: id });
  }
  return deleted;
});
