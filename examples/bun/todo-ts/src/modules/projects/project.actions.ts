import { action, type ChimpbaseContext, v } from "@chimpbase/runtime";
import {
  normalizeCreateProjectInput,
} from "./project.domain.ts";
import {
  findProjectBySlug,
  insertProject,
  listProjects as listProjectsFromRepository,
} from "./project.repository.ts";
import type {
  CreateProjectInput,
  ProjectRecord,
} from "./project.types.ts";

const listProjects = action({
  name: "listProjects",
  async handler(
    ctx: ChimpbaseContext,
  ): Promise<ProjectRecord[]> {
    return await listProjectsFromRepository(ctx);
  },
});

const createProject = action({
  args: v.object({
    name: v.string(),
    ownerEmail: v.string(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: CreateProjectInput,
  ): Promise<ProjectRecord> {
    const normalized = normalizeCreateProjectInput(input);
    const existing = await findProjectBySlug(ctx, normalized.slug);
    if (existing) {
      return existing;
    }

    return await insertProject(ctx, normalized);
  },
  name: "createProject",
});

export {
  createProject,
  listProjects,
};
