import { Module } from "@nestjs/common";

import { ProjectFeatureModule } from "../modules/projects/project.nest.ts";
import { TodoFeatureModule } from "../modules/todos/todo.nest.ts";

@Module({
  imports: [ProjectFeatureModule, TodoFeatureModule],
})
export class AppModule {}
