import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../actions/agent.actions.ts";
import {
  cancelTask,
  createTask,
  getTask,
  listTasks,
} from "../actions/task.actions.ts";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

// ── Agents ──────────────────────────────────────────────────────────────

app.post("/agents", async (c) => {
  const body = await c.req.json();
  const agent = await c.env.action(createAgent, body);
  return c.json(agent, 201);
});

app.get("/agents", async (c) => {
  const agents = await c.env.action(listAgents);
  return c.json(agents);
});

app.get("/agents/:id", async (c) => {
  const agent = await c.env.action(getAgent, c.req.param("id"));
  if (!agent) return c.json({ error: "agent not found" }, 404);
  return c.json(agent);
});

app.patch("/agents/:id", async (c) => {
  const body = await c.req.json();
  const agent = await c.env.action(updateAgent, { id: c.req.param("id"), ...body });
  if (!agent) return c.json({ error: "agent not found" }, 404);
  return c.json(agent);
});

app.delete("/agents/:id", async (c) => {
  const deleted = await c.env.action(deleteAgent, c.req.param("id"));
  if (deleted === 0) return c.json({ error: "agent not found" }, 404);
  return c.body(null, 204);
});

// ── Tasks ───────────────────────────────────────────────────────────────

app.post("/agents/:id/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const task = await c.env.action(createTask, {
    agentId: c.req.param("id"),
    prompt: (body as Record<string, unknown>).prompt as string | undefined,
  });
  return c.json(task, 201);
});

app.get("/tasks", async (c) => {
  const status = c.req.query("status");
  const agentId = c.req.query("agentId");
  const tasks = await c.env.action(listTasks, { status, agentId });
  return c.json(tasks);
});

app.get("/tasks/:id", async (c) => {
  const task = await c.env.action(getTask, c.req.param("id"));
  if (!task) return c.json({ error: "task not found" }, 404);
  return c.json(task);
});

app.post("/tasks/:id/cancel", async (c) => {
  const task = await c.env.action(cancelTask, c.req.param("id"));
  if (!task) return c.json({ error: "task not found" }, 404);
  return c.json(task);
});

// ── Activity Stream ─────────────────────────────────────────────────────

app.get("/activity", async (c) => {
  const sinceId = c.req.query("sinceId") ? Number(c.req.query("sinceId")) : undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50;
  const events = await c.env.action("listActivity", { sinceId, limit });
  return c.json(events);
});

// ── Config ──────────────────────────────────────────────────────────────

app.get("/config", async (c) => {
  const config = await c.env.action("getConfig");
  return c.json(config);
});

app.patch("/config", async (c) => {
  const body = await c.req.json();
  const config = await c.env.action("updateConfig", body);
  return c.json(config);
});

export { app as agentApiApp };
