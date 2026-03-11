export interface ProjectRecord {
  id: number;
  slug: string;
  name: string;
  owner_email: string;
  created_at: string;
}

export interface CreateProjectInput {
  name: string;
  ownerEmail: string;
}

export interface NormalizedProjectInput {
  slug: string;
  name: string;
  ownerEmail: string;
}
