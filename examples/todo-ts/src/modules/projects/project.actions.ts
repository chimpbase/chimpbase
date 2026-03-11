import type { ChimpbaseContext } from "@chimpbase/runtime";
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

const listProjects = async (
  ctx: ChimpbaseContext,
): Promise<ProjectRecord[]> => {
  return await listProjectsFromRepository(ctx);
};

const createProject = async (
  ctx: ChimpbaseContext,
  input: CreateProjectInput,
): Promise<ProjectRecord> => {
  const normalized = normalizeCreateProjectInput(input);
  const existing = await findProjectBySlug(ctx, normalized.slug);
  if (existing) {
    return existing;
  }

  return await insertProject(ctx, normalized);
};

export {
  createProject,
  listProjects,
};
