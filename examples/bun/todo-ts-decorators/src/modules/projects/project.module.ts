import {
  Action,
  type ChimpbaseContext,
} from "@chimpbase/runtime";

import { normalizeCreateProjectInput } from "./project.domain.ts";
import { ProjectRepository } from "./project.repository.ts";
import type {
  CreateProjectInput,
  ProjectRecord,
} from "./project.types.ts";

export class ProjectModule {
  constructor(private readonly projects: ProjectRepository) {}

  @Action("listProjects")
  async listProjects(ctx: ChimpbaseContext): Promise<ProjectRecord[]> {
    return await this.projects.list(ctx.db);
  }

  @Action("createProject")
  async createProject(
    ctx: ChimpbaseContext,
    input: CreateProjectInput,
  ): Promise<ProjectRecord> {
    const normalized = normalizeCreateProjectInput(input);
    const existing = await this.projects.findBySlug(ctx.db, normalized.slug);
    if (existing) {
      return existing;
    }

    return await this.projects.insert(ctx.db, normalized);
  }
}
