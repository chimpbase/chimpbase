import type { ChimpbaseContext } from "@chimpbase/runtime";
import type {
  NormalizedProjectInput,
  ProjectRecord,
} from "./project.types.ts";

export async function listProjects(ctx: ChimpbaseContext): Promise<ProjectRecord[]> {
  return await ctx.db.query<ProjectRecord>(
    "SELECT id, slug, name, owner_email, created_at FROM projects ORDER BY name ASC",
  );
}

export async function findProjectBySlug(
  ctx: ChimpbaseContext,
  slug: string,
): Promise<ProjectRecord | null> {
  const [project] = await ctx.db.query<ProjectRecord>(
    "SELECT id, slug, name, owner_email, created_at FROM projects WHERE slug = ?1 LIMIT 1",
    [slug],
  );
  return project ?? null;
}

export async function requireProjectBySlug(
  ctx: ChimpbaseContext,
  slug: string,
): Promise<ProjectRecord> {
  const project = await findProjectBySlug(ctx, slug);
  if (!project) {
    throw new Error(`project not found: ${slug}`);
  }

  return project;
}

export async function insertProject(
  ctx: ChimpbaseContext,
  input: NormalizedProjectInput,
): Promise<ProjectRecord> {
  await ctx.db.query(
    "INSERT INTO projects (slug, name, owner_email) VALUES (?1, ?2, ?3)",
    [input.slug, input.name, input.ownerEmail],
  );

  return await requireProjectBySlug(ctx, input.slug);
}
