import {
  Action,
  type ChimpbaseContext,
} from "@chimpbase/runtime";

import {
  createProject,
  listProjects,
} from "./project.actions.ts";
import type {
  CreateProjectInput,
  ProjectRecord,
} from "./project.types.ts";

export class ProjectModule {
  @Action("listProjects")
  static async listProjects(ctx: ChimpbaseContext): Promise<ProjectRecord[]> {
    return await listProjects(ctx);
  }

  @Action("createProject")
  static async createProject(
    ctx: ChimpbaseContext,
    input: CreateProjectInput,
  ): Promise<ProjectRecord> {
    return await createProject(ctx, input);
  }
}
