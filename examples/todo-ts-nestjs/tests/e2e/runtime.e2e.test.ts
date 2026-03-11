import { afterEach, describe, expect, test } from "bun:test";

import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { todoApiApp } from "../../src/http/app.ts";
import {
  createProjectFixture,
  runAction,
  startServer,
} from "../support/runtime-harness.ts";

const fixtures: Array<{ cleanup(): Promise<void> }> = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    await fixtures.pop()?.cleanup();
  }
});

describe("todo-ts runtime", () => {
test("executes modular seed and query actions through the CLI", async () => {
    const fixture = await createProjectFixture("cli");
    fixtures.push(fixture);

    const seedOutput = await runAction(fixture.projectDir, "seedDemoWorkspace");
    const listOutput = await runAction(fixture.projectDir, "listProjects");

    expect(seedOutput).toContain("executed action seedDemoWorkspace");
    expect(seedOutput).toContain("Operations Platform");
    expect(listOutput).toContain("operations-platform");
    expect(listOutput).toContain("Revenue Enablement");
  }, 20000);

  test("routes a realistic workflow through the Hono app contract", async () => {
    const calls: Array<{ args: unknown[]; name: string }> = [];
    const completedTodo = {
      id: 42,
      project_id: 7,
      project_slug: "platform-reliability",
      project_name: "Platform Reliability",
      title: "Close production incident review",
      description: "Publish the final remediation checklist.",
      status: "done",
      priority: "critical",
      assignee_email: "manager@chimpbase.dev",
      due_date: "2026-03-21",
      created_at: "2026-03-08 01:30:00",
      updated_at: "2026-03-08 01:35:00",
      completed_at: "2026-03-08 01:35:00",
    };

    const env: ChimpbaseRouteEnv = {
      async action<TArgs extends unknown[] = unknown[], TResult = unknown>(
        name: string,
        ...args: TArgs
      ): Promise<TResult> {
        calls.push({ name, args });

        const result = (() => {
        switch (name) {
          case "createProject":
            return {
              id: 7,
              slug: "platform-reliability",
              name: "Platform Reliability",
              owner_email: "owner@chimpbase.dev",
              created_at: "2026-03-08 01:30:00",
            };
          case "createTodo":
            return {
              ...completedTodo,
              status: "backlog",
              assignee_email: "sre@chimpbase.dev",
              completed_at: null,
            };
          case "assignTodo":
            return {
              ...completedTodo,
              status: "backlog",
              completed_at: null,
            };
          case "startTodo":
            return {
              ...completedTodo,
              status: "in_progress",
              completed_at: null,
            };
          case "completeTodo":
            return completedTodo;
          case "getTodoDashboard":
            return {
              total: 1,
              backlog: 0,
              in_progress: 0,
              blocked: 0,
              done: 1,
              assigned: 1,
              overdue: 0,
            };
          case "listTodoAuditLog":
            return [
              { event_name: "todo.created" },
              { event_name: "todo.assigned" },
              { event_name: "todo.started" },
              { event_name: "todo.completed" },
            ];
          case "listTodoEvents":
            return [
              { event_name: "todo.created" },
              { event_name: "todo.assigned" },
              { event_name: "todo.started" },
              { event_name: "todo.completed" },
            ];
          case "listTodos":
            return [completedTodo];
          default:
            throw new Error(`unexpected action: ${name}`);
        }
        })();

        return result as TResult;
      },
    };

    const projectResponse = await todoApiApp.request(
      "http://todo.test/projects",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Platform Reliability",
          ownerEmail: "owner@chimpbase.dev",
        }),
      },
      env,
    );
    expect(projectResponse.status).toBe(201);

    const createTodoResponse = await todoApiApp.request(
      "http://todo.test/todos",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectSlug: "platform-reliability",
          title: "Close production incident review",
          description: "Publish the final remediation checklist.",
          priority: "critical",
          assigneeEmail: "sre@chimpbase.dev",
          dueDate: "2026-03-21",
        }),
      },
      env,
    );
    expect(createTodoResponse.status).toBe(201);
    const createdTodo = await createTodoResponse.json();

    const assignResponse = await todoApiApp.request(
      `http://todo.test/todos/${createdTodo.id}/assign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assigneeEmail: "manager@chimpbase.dev" }),
      },
      env,
    );
    expect(assignResponse.status).toBe(200);

    const startResponse = await todoApiApp.request(
      `http://todo.test/todos/${createdTodo.id}/start`,
      { method: "POST" },
      env,
    );
    expect(startResponse.status).toBe(200);

    const completeResponse = await todoApiApp.request(
      `http://todo.test/todos/${createdTodo.id}/complete`,
      { method: "POST" },
      env,
    );
    expect(completeResponse.status).toBe(200);

    const dashboardResponse = await todoApiApp.request(
      "http://todo.test/dashboard?projectSlug=platform-reliability",
      undefined,
      env,
    );
    expect(dashboardResponse.status).toBe(200);

    const auditLogResponse = await todoApiApp.request(
      "http://todo.test/audit-log",
      undefined,
      env,
    );
    expect(auditLogResponse.status).toBe(200);
    expect(await auditLogResponse.json()).toHaveLength(4);

    const eventsResponse = await todoApiApp.request(
      "http://todo.test/events",
      undefined,
      env,
    );
    expect(eventsResponse.status).toBe(200);

    const listResponse = await todoApiApp.request(
      "http://todo.test/todos?projectSlug=platform-reliability&status=done",
      undefined,
      env,
    );
    expect(listResponse.status).toBe(200);

    expect(calls.map((call) => call.name)).toEqual([
      "createProject",
      "createTodo",
      "assignTodo",
      "startTodo",
      "completeTodo",
      "getTodoDashboard",
      "listTodoAuditLog",
      "listTodoEvents",
      "listTodos",
    ]);
  }, 20000);

  test("starts the project through the library bootstrap script", async () => {
    const fixture = await createProjectFixture("server");
    fixtures.push(fixture);

    const server = await startServer(fixture.projectDir, fixture.port);

    try {
      const healthResponse = await fetch(`${server.url}/health`);
      expect(healthResponse.status).toBe(200);

      const seedResponse = await fetch(`${server.url}/seed`, {
        method: "POST",
      });
      expect(seedResponse.status).toBe(201);

      const projectsResponse = await fetch(`${server.url}/projects`);
      expect(projectsResponse.status).toBe(200);

      const projects = await projectsResponse.json() as Array<{ slug: string }>;
      expect(projects.some((project) => project.slug === "operations-platform")).toBe(true);
    } finally {
      await server.stop();
    }
  }, 20000);
});
