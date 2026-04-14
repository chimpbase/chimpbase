import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { chimpbaseAuth } from "@chimpbase/auth";
import { chimpbaseWebhooks, hmac } from "@chimpbase/webhooks";
import {
  action,
  cron,
  subscription,
  worker,
} from "@chimpbase/runtime";

import { agentApiApp } from "./src/http/app.ts";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "./src/actions/agent.actions.ts";
import {
  cancelTask,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
} from "./src/actions/task.actions.ts";
import { dispatchPendingTasks } from "./src/cron/dispatcher.ts";
import { scheduleAgentTasks } from "./src/cron/scheduler.ts";
import { executeAgentTask, handleExecutorDlq } from "./src/workers/executor.ts";
import {
  logTaskCancelled,
  logTaskCompleted,
  logTaskCreated,
  logTaskFailed,
} from "./src/subscriptions/activity.ts";

const registrations = [
  // ── Plugins ─────────────────────────────────────────────────────────
  chimpbaseAuth({
    bootstrapKeySecret: "AGENT_MANAGER_BOOTSTRAP_KEY",
    excludePaths: ["/health", "/webhooks/github"],
  }),
  chimpbaseWebhooks({
    allowedEvents: [
      "task.created", "task.started", "task.completed", "task.failed", "task.cancelled",
      "agent.created", "agent.updated", "agent.deleted",
    ],
    inbound: {
      github: {
        path: "/webhooks/github",
        publishAs: "github.push",
        verify: hmac({
          signatureHeader: "x-hub-signature-256",
          secretName: "GITHUB_WEBHOOK_SECRET",
          prefix: "sha256=",
        }),
        deduplicationKey: (req) => req.headers.get("x-github-delivery"),
      },
    },
  }),

  // ── Agent actions ───────────────────────────────────────────────────
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,

  // ── Task actions ────────────────────────────────────────────────────
  createTask,
  listTasks,
  getTask,
  cancelTask,
  updateTaskStatus,

  // ── Config actions ──────────────────────────────────────────────────
  action("getConfig", async (ctx) => {
    const maxParallel = await ctx.kv.get<number>("config.maxParallel") ?? 3;
    return { maxParallel };
  }),
  action("updateConfig", async (ctx, input: { maxParallel?: number }) => {
    if (input.maxParallel !== undefined) {
      await ctx.kv.set("config.maxParallel", input.maxParallel);
    }
    const maxParallel = await ctx.kv.get<number>("config.maxParallel") ?? 3;
    ctx.log.info("config updated", { maxParallel });
    return { maxParallel };
  }),

  // ── Activity stream action ──────────────────────────────────────────
  action("listActivity", async (ctx, input: { sinceId?: number; limit?: number }) => {
    return await ctx.stream.read("agent.activity", {
      sinceId: input.sinceId,
      limit: input.limit ?? 50,
    });
  }),

  // ── Cron jobs ───────────────────────────────────────────────────────
  cron("agent.dispatcher", "* * * * *", dispatchPendingTasks),
  cron("agent.scheduler", "* * * * *", scheduleAgentTasks),

  // ── Workers ─────────────────────────────────────────────────────────
  worker("agent.execute", executeAgentTask, { dlq: "agent.execute.dlq" }),
  worker("agent.execute.dlq", handleExecutorDlq, { dlq: false }),

  // ── Subscriptions (activity stream + metrics) ───────────────────────
  subscription("task.created", logTaskCreated, { idempotent: true, name: "logTaskCreated" }),
  subscription("task.completed", logTaskCompleted, { idempotent: true, name: "logTaskCompleted" }),
  subscription("task.failed", logTaskFailed, { idempotent: true, name: "logTaskFailed" }),
  subscription("task.cancelled", logTaskCancelled, { idempotent: true, name: "logTaskCancelled" }),

  // ── Inbound webhook → task creation ─────────────────────────────────
  subscription("github.push", async (ctx, payload: { ref?: string; repository?: { full_name?: string } }) => {
    const agents = await ctx.collection.find("agents", { active: true });
    for (const agent of agents) {
      const agentRecord = agent as { id: string; name: string; schedule: string | null };
      // Only trigger agents that are not cron-scheduled (manual/webhook-triggered agents)
      if (!agentRecord.schedule) {
        const ref = payload.ref ?? "unknown";
        const repo = payload.repository?.full_name ?? "unknown";
        await ctx.action("createTask", {
          agentId: agentRecord.id,
          prompt: `Review push to ${ref} in ${repo}`,
        });
      }
    }
  }, { idempotent: true, name: "githubPushTrigger" }),
];

export default {
  httpHandler: agentApiApp,
  project: { name: "agent-manager" },
  telemetry: {
    minLevel: "info" as const,
    persist: { log: true, metric: true, trace: true },
  },
  worker: { maxAttempts: 3, retryDelayMs: 5000 },
  registrations,
} satisfies ChimpbaseAppDefinitionInput;
