#!/usr/bin/env bun

import { resolve } from "node:path";

import {
  runChimpbaseAction,
  startChimpbaseProject,
  syncChimpbaseSchema,
  syncChimpbaseWorkflowContracts,
} from "./library.ts";

const [, , command = "dev", maybeSubcommand, ...rawRest] = Bun.argv;
const subcommand = maybeSubcommand && !maybeSubcommand.startsWith("--") ? maybeSubcommand : null;
const rest = subcommand ? rawRest : [maybeSubcommand, ...rawRest].filter((token): token is string => Boolean(token));

const args = parseArgs(rest);
const projectDirArg = args["project-dir"];
const projectDir = resolve(typeof projectDirArg === "string" ? projectDirArg : ".");

if (command === "contracts") {
  const { host, result } = await syncChimpbaseWorkflowContracts({
    allowBreaking: args["allow-breaking"] === true,
    check: args.check === true,
    projectDir,
  });

  try {
    if (result.entries.length === 0) {
      console.log(`no workflow contracts registered for project ${host.config.project.name}`);
    } else {
      for (const entry of result.entries) {
        console.log(
          `${entry.status} workflow contract ${entry.contract.name} v${entry.contract.version} (${entry.compatibility})`,
        );
      }
    }

    console.log(`contracts directory ${result.contractsDir}`);
  } finally {
    host.close();
  }
} else if (command === "schema") {
  if (subcommand !== "generate" && subcommand !== "check") {
    throw new Error("schema command expects `generate` or `check`");
  }

  const result = await syncChimpbaseSchema({
    check: subcommand === "check",
    dockerImage: typeof args["docker-image"] === "string" ? args["docker-image"] : undefined,
    outputDir: typeof args["output-dir"] === "string" ? args["output-dir"] : undefined,
    projectDir,
  });

  if (subcommand === "check") {
    console.log(`schema check passed for project ${result.projectName}`);
  } else {
    console.log(`${result.status} schema artifacts for project ${result.projectName}`);
  }

  console.log(`schema snapshot ${result.snapshotPath}`);
  console.log(`schema types ${result.typesPath}`);
} else if (command !== "dev") {
  throw new Error(`unsupported command: ${command}`);
} else if (typeof args.action === "string") {
  const actionArgs = typeof args.args === "string" ? JSON.parse(args.args) : [];
  if (!Array.isArray(actionArgs)) {
    throw new Error("--args must be a JSON array");
  }

  const { host, outcome } = await runChimpbaseAction(args.action, actionArgs, {
    projectDir,
  });
  console.log(`executed action ${args.action} for project ${host.config.project.name}`);
  console.log(JSON.stringify(outcome.result, null, 2));
  console.log(`emitted ${outcome.emittedEvents.length} event(s)`);
  host.close();
} else {
  const serveFlag = args.serve === true;
  const workerFlag = args.worker === true;
  const started = await startChimpbaseProject({
    projectDir,
    runWorker: workerFlag ? true : undefined,
    serve: serveFlag ? true : undefined,
  });

  if (started.server) {
    const server = started.server;
    console.log(`listening on http://127.0.0.1:${server.port}`);
    if (workerFlag || !serveFlag) {
      console.log("queue worker started");
    }
  } else if (workerFlag) {
    console.log("queue worker started");
  } else {
    await started.stop();
    throw new Error("bun host currently supports default mode, --serve, --worker or --action");
  }
}

function parseArgs(rawArgs: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}
