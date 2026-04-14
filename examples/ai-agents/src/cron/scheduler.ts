import type { ChimpbaseContext, ChimpbaseCronInvocation } from "@chimpbase/runtime";
import type { AgentRecord } from "../actions/agent.actions.ts";

const AGENTS_COLLECTION = "agents";

export async function scheduleAgentTasks(
  ctx: ChimpbaseContext,
  invocation: ChimpbaseCronInvocation,
): Promise<void> {
  const agents = await ctx.collection.find<AgentRecord>(AGENTS_COLLECTION, { active: true });
  const fireDate = new Date(invocation.fireAtMs);

  for (const agent of agents) {
    if (!agent.schedule) continue;

    if (matchesCronMinute(agent.schedule, fireDate)) {
      await ctx.action("createTask", { agentId: agent.id });
      ctx.log.info("scheduled task created", { agentId: agent.id, agentName: agent.name, schedule: agent.schedule });
    }
  }
}

function matchesCronMinute(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts;
  return (
    matchesField(minuteExpr!, date.getMinutes(), 0, 59) &&
    matchesField(hourExpr!, date.getHours(), 0, 23) &&
    matchesField(dayExpr!, date.getDate(), 1, 31) &&
    matchesField(monthExpr!, date.getMonth() + 1, 1, 12) &&
    matchesField(dowExpr!, date.getDay(), 0, 7)
  );
}

function matchesField(expr: string, value: number, _min: number, _max: number): boolean {
  if (expr === "*") return true;

  for (const part of expr.split(",")) {
    if (part.includes("/")) {
      const [rangeExpr, stepStr] = part.split("/");
      const step = parseInt(stepStr!, 10);
      if (rangeExpr === "*") {
        if (value % step === 0) return true;
      }
    } else if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      if (value >= start && value <= end) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }

  return false;
}
