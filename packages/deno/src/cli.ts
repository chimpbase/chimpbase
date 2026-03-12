import { runDenoCli } from "./library.ts";

const meta = import.meta as ImportMeta & { main?: boolean };

if (meta.main) {
  await runDenoCli();
}
