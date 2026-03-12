import { defineChimpbaseMigration } from "@chimpbase/core";

export default defineChimpbaseMigration({
  name: "001_init",
  sql: `CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todo_items (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_email TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_todo_items_project_status ON todo_items(project_id, status);
CREATE INDEX IF NOT EXISTS idx_todo_items_assignee_status ON todo_items(assignee_email, status);

CREATE TABLE IF NOT EXISTS todo_audit_log (
  id INTEGER PRIMARY KEY,
  event_name TEXT NOT NULL,
  todo_id INTEGER NOT NULL,
  project_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee_email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_todo_audit_log_todo_id ON todo_audit_log(todo_id);

CREATE TABLE IF NOT EXISTS todo_notifications (
  id INTEGER PRIMARY KEY,
  queue_name TEXT NOT NULL,
  todo_id INTEGER NOT NULL,
  project_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  recipient_email TEXT,
  sender_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_todo_notifications_todo_id ON todo_notifications(todo_id);
`,
});
