import { defineChimpbaseMigrations } from "@chimpbase/core";

import postgresInit from "./migrations/postgres/001_init.ts";

export default defineChimpbaseMigrations({
  postgres: [postgresInit],
});
