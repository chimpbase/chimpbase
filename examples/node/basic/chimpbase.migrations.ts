import { defineChimpbaseMigrations } from "@chimpbase/core";

export default defineChimpbaseMigrations({
  sqlite: [
    {
      name: "001_init",
      sql: `CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    },
  ],
});
