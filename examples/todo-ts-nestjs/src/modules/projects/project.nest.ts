import { Injectable, Module } from "@nestjs/common";
import type { ChimpbaseContext } from "@chimpbase/runtime";

import {
  createProject,
  listProjects,
} from "./project.actions.ts";
import type {
  CreateProjectInput,
  ProjectRecord,
} from "./project.types.ts";

@Injectable()
export class ProjectActionsService {
  async listProjects(ctx: ChimpbaseContext): Promise<ProjectRecord[]> {
    return await listProjects(ctx);
  }

  async createProject(
    ctx: ChimpbaseContext,
    input: CreateProjectInput,
  ): Promise<ProjectRecord> {
    return await createProject(ctx, input);
  }
}

@Module({
  exports: [ProjectActionsService],
  providers: [ProjectActionsService],
})
export class ProjectFeatureModule {}
