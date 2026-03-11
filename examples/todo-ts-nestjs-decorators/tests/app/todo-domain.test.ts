import { describe, expect, test } from "bun:test";

import {
  assertStatusTransition,
  normalizeCreateTodoInput,
  normalizeTodoFilters,
} from "../../src/modules/todos/todo.domain.ts";

describe("todo domain", () => {
  test("normalizes create payloads with defaults", () => {
    expect(
      normalizeCreateTodoInput({
        projectSlug: " Operations-Platform ",
        title: "  Ship audit trail  ",
        description: "  include assignment changes ",
        assigneeEmail: " Alice@Chimpbase.dev ",
      }),
    ).toEqual({
      projectSlug: "operations-platform",
      title: "Ship audit trail",
      description: "include assignment changes",
      priority: "medium",
      assigneeEmail: "alice@chimpbase.dev",
      dueDate: null,
    });
  });

  test("normalizes list filters", () => {
    expect(
      normalizeTodoFilters({
        projectSlug: " Operations-Platform ",
        status: " in_progress ",
        priority: " high ",
        assigneeEmail: " ALICE@chimpbase.dev ",
        search: " latency ",
      }),
    ).toEqual({
      projectSlug: "operations-platform",
      status: "in_progress",
      priority: "high",
      assigneeEmail: "alice@chimpbase.dev",
      search: "latency",
    });
  });

  test("rejects invalid state transitions", () => {
    expect(() => assertStatusTransition("backlog", "done")).toThrow(
      "cannot move todo from backlog to done",
    );
    expect(() => assertStatusTransition("done", "in_progress")).toThrow(
      "cannot move todo from done to in_progress",
    );
  });
});
