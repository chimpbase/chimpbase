export interface FactoryRecord {
  id: number;
  code: string;
  name: string;
  manager_email: string;
  created_at: string;
}

export interface CreateFactoryInput {
  name: string;
  managerEmail: string;
}
