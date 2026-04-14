import { createChimpbase } from "@chimpbase/bun";

import app from "./chimpbase.app.ts";

const chimpbase = await createChimpbase({
  ...app,
  projectDir: import.meta.dir,
});

await chimpbase.start();
