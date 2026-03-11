import { describe, expect, test } from "bun:test";

import {
  createProjectSlug,
  normalizeCreateProjectInput,
} from "../../src/modules/projects/project.domain.ts";

describe("project domain", () => {
  test("creates stable slugs from project names", () => {
    expect(createProjectSlug("Operations Platform")).toBe("operations-platform");
    expect(createProjectSlug("Revenue / Enablement")).toBe("revenue-enablement");
  });

  test("normalizes project payloads", () => {
    expect(
      normalizeCreateProjectInput({
        name: "  Platform Reliability  ",
        ownerEmail: "TEAM.LEAD@chimpbase.dev ",
      }),
    ).toEqual({
      slug: "platform-reliability",
      name: "Platform Reliability",
      ownerEmail: "team.lead@chimpbase.dev",
    });
  });

  test("rejects invalid owner emails", () => {
    expect(() =>
      normalizeCreateProjectInput({
        name: "Bad Project",
        ownerEmail: "invalid",
      })
    ).toThrow("ownerEmail must be a valid email");
  });
});
