import type {
  CreateProjectInput,
  NormalizedProjectInput,
} from "./project.types.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createProjectSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error("project name must contain letters or numbers");
  }

  return slug;
}

export function normalizeProjectOwnerEmail(ownerEmail: string): string {
  const normalized = ownerEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new Error("ownerEmail must be a valid email");
  }

  return normalized;
}

export function normalizeCreateProjectInput(
  input: CreateProjectInput,
): NormalizedProjectInput {
  const name = input.name.trim();
  if (name.length < 3) {
    throw new Error("project name must have at least 3 characters");
  }

  return {
    slug: createProjectSlug(name),
    name,
    ownerEmail: normalizeProjectOwnerEmail(input.ownerEmail),
  };
}
