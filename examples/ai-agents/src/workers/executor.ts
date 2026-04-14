import type { ChimpbaseContext, ChimpbaseDlqEnvelope } from "@chimpbase/runtime";
import type { AgentRecord } from "../actions/agent.actions.ts";
import type { TaskRecord } from "../actions/task.actions.ts";

const AGENTS_COLLECTION = "agents";
const EXECUTION_TIMEOUT_MS = 600_000; // 10 minutes

export async function executeAgentTask(
  ctx: ChimpbaseContext,
  payload: { taskId: string },
): Promise<void> {
  const task = await ctx.collection.findOne<TaskRecord>("tasks", { id: payload.taskId });
  if (!task || task.status !== "pending") {
    ctx.log.warn("task not found or not pending, skipping", { taskId: payload.taskId, status: task?.status ?? null });
    return;
  }

  const agent = await ctx.collection.findOne<AgentRecord>(AGENTS_COLLECTION, { id: task.agentId });
  if (!agent) {
    await ctx.action("updateTaskStatus", { taskId: task.id, status: "failed", error: "agent not found" });
    ctx.pubsub.publish("task.failed", { ...task, status: "failed", error: "agent not found" });
    return;
  }

  await ctx.trace("agent.execute", async (span) => {
    span.setAttribute("agent.name", agent.name);
    span.setAttribute("docker.image", agent.dockerImage);
    span.setAttribute("task.id", task.id);

    // Mark as running
    await ctx.action("updateTaskStatus", { taskId: task.id, status: "running" });
    ctx.pubsub.publish("task.started", { ...task, status: "running" });
    ctx.metric("agent.tasks.running", 1);

    const startTime = Date.now();
    const apiKey = ctx.secret("ANTHROPIC_API_KEY") ?? "";
    const agentEnv = parseEnv(agent.env);

    // Build execution args — use docker or local claude CLI
    const useLocal = agent.dockerImage === "local";
    let args: string[];

    if (useLocal) {
      args = ["claude", "-p", task.prompt, "--output-format", "text", "--dangerously-skip-permissions"];
    } else {
      args = ["docker", "run", "--rm"];
      // Auth: mount OAuth credentials or pass API key
      const claudeCredentials = `${process.env.HOME ?? "/root"}/.claude/.credentials.json`;
      args.push("-v", `${claudeCredentials}:/root/.claude/.credentials.json:ro`);
      if (apiKey) {
        args.push("-e", `ANTHROPIC_API_KEY=${apiKey}`);
      }
      for (const [key, value] of Object.entries(agentEnv)) {
        args.push("-e", `${key}=${value}`);
      }
      if (agent.repoUrl) {
        args.push("-v", `/tmp/agent-workspace-${task.id}:/workspace`);
        args.push("-w", "/workspace");
      }
      args.push(agent.dockerImage);
      args.push("claude", "-p", task.prompt, "--output-format", "text");
    }

    ctx.log.info(`starting ${useLocal ? "local" : "docker"} agent`, {
      taskId: task.id,
      agentName: agent.name,
      image: agent.dockerImage,
    });

    let stdout = "";
    let stderr = "";
    let exitCode = -1;

    try {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeout = setTimeout(() => {
        proc.kill();
      }, EXECUTION_TIMEOUT_MS);

      [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      clearTimeout(timeout);
    } catch (err) {
      stderr = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startTime;
    span.setAttribute("exit.code", exitCode);
    span.setAttribute("duration.ms", durationMs);
    ctx.metric("agent.tasks.duration_ms", durationMs, { agentName: agent.name });

    if (exitCode === 0) {
      await ctx.action("updateTaskStatus", {
        taskId: task.id,
        status: "completed",
        output: stdout,
      });
      const completed = await ctx.collection.findOne<TaskRecord>("tasks", { id: task.id });
      ctx.pubsub.publish("task.completed", completed);
      ctx.metric("agent.tasks.completed", 1, { agentName: agent.name });
      ctx.log.info("task completed", { taskId: task.id, agentName: agent.name, durationMs });
    } else {
      const errorMsg = stderr || `exit code ${exitCode}`;
      await ctx.action("updateTaskStatus", {
        taskId: task.id,
        status: "failed",
        error: errorMsg,
      });
      const failed = await ctx.collection.findOne<TaskRecord>("tasks", { id: task.id });
      ctx.pubsub.publish("task.failed", failed);
      ctx.metric("agent.tasks.failed", 1, { agentName: agent.name });
      ctx.log.error("task failed", { taskId: task.id, agentName: agent.name, error: errorMsg, exitCode });
      throw new Error(`agent task failed: ${errorMsg}`);
    }
  }, { taskId: task.id, agentId: agent.id });
}

export async function handleExecutorDlq(
  ctx: ChimpbaseContext,
  envelope: ChimpbaseDlqEnvelope<{ taskId: string }>,
): Promise<void> {
  ctx.log.error("agent task exhausted all retries", {
    taskId: envelope.payload.taskId,
    attempts: envelope.attempts,
    error: envelope.error,
    queue: envelope.queue,
  });
}

function parseEnv(envJson: string): Record<string, string> {
  try {
    return JSON.parse(envJson) as Record<string, string>;
  } catch {
    return {};
  }
}
