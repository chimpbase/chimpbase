#!/usr/bin/env bun

import { runChimpbaseCli } from "@chimpbase/tooling/cli";

import {
  runChimpbaseAction,
  startChimpbaseProject,
  syncChimpbaseSchema,
  syncChimpbaseWorkflowContracts,
} from "./library.ts";

await runChimpbaseCli(Bun.argv.slice(2), {
  runAction: runChimpbaseAction,
  startProject: startChimpbaseProject,
  syncSchema: syncChimpbaseSchema,
  syncWorkflowContracts: syncChimpbaseWorkflowContracts,
});
