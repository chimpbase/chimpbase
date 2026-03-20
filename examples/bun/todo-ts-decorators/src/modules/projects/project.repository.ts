import type { ChimpbaseDbClient } from "@chimpbase/runtime";
import type {
  NormalizedProjectInput,
  ProjectRecord,
} from "./project.types.ts";

export class ProjectRepository {
  async list(db: ChimpbaseDbClient): Promise<ProjectRecord[]> {
    return await db.query<ProjectRecord>(
      "SELECT id, slug, name, owner_email, created_at FROM projects ORDER BY name ASC",
    );
  }

  async findBySlug(
    db: ChimpbaseDbClient,
    slug: string,
  ): Promise<ProjectRecord | null> {
    const [project] = await db.query<ProjectRecord>(
      "SELECT id, slug, name, owner_email, created_at FROM projects WHERE slug = ?1 LIMIT 1",
      [slug],
    );
    return project ?? null;
  }

  async requireBySlug(
    db: ChimpbaseDbClient,
    slug: string,
  ): Promise<ProjectRecord> {
    const project = await this.findBySlug(db, slug);
    if (!project) {
      throw new Error(`project not found: ${slug}`);
    }

    return project;
  }

  async insert(
    db: ChimpbaseDbClient,
    input: NormalizedProjectInput,
  ): Promise<ProjectRecord> {
    await db.query(
      "INSERT INTO projects (slug, name, owner_email) VALUES (?1, ?2, ?3)",
      [input.slug, input.name, input.ownerEmail],
    );

    return await this.requireBySlug(db, input.slug);
  }
}
