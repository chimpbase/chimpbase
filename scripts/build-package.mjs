import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tscEntrypoint = resolve(repoRoot, "node_modules/typescript/bin/tsc");

const packageConfigs = {
  auth: {
    dir: "packages/auth",
    types: ["node"],
  },
  bun: {
    dir: "packages/bun",
    types: ["bun-types", "node"],
  },
  core: {
    dir: "packages/core",
    types: ["node"],
  },
  host: {
    dir: "packages/host",
    types: ["node"],
  },
  deno: {
    dir: "packages/deno",
    types: ["node"],
  },
  node: {
    dir: "packages/node",
    types: ["node"],
  },
  otel: {
    dir: "packages/otel",
    types: ["node"],
  },
  pact: {
    dir: "packages/pact",
    types: ["node"],
  },
  postgres: {
    dir: "packages/postgres",
    types: ["node"],
  },
  "rest-collections": {
    dir: "packages/rest-collections",
    types: ["node"],
  },
  runtime: {
    dir: "packages/runtime",
    types: ["node"],
  },
  tooling: {
    dir: "packages/tooling",
    types: ["node"],
  },
  webhooks: {
    dir: "packages/webhooks",
    types: ["node"],
  },
};

const requestedPackages = process.argv.slice(2);
const packageNames = requestedPackages.length > 0 ? requestedPackages : Object.keys(packageConfigs);

for (const packageName of packageNames) {
  if (!(packageName in packageConfigs)) {
    throw new Error(`unsupported package build target: ${packageName}`);
  }
}

for (const packageName of packageNames) {
  const config = packageConfigs[packageName];
  const packageDir = resolve(repoRoot, config.dir);
  const outDir = resolve(packageDir, "dist");
  const sourceFiles = await listTypescriptFiles(packageDir);

  await rm(outDir, { force: true, recursive: true });

  if (sourceFiles.length === 0) {
    throw new Error(`no TypeScript files found for ${packageName}`);
  }

  const result = spawnSync(
    process.execPath,
    [
      tscEntrypoint,
      "--allowImportingTsExtensions",
      "--declaration",
      "--declarationMap",
      "false",
      "--lib",
      "ES2022,DOM",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--outDir",
      outDir,
      "--pretty",
      "false",
      "--rewriteRelativeImportExtensions",
      "--rootDir",
      packageDir,
      "--skipLibCheck",
      "--sourceMap",
      "false",
      "--strict",
      "--target",
      "ES2022",
      "--types",
      config.types.join(","),
      ...sourceFiles,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`failed to build ${packageName}`);
  }
}

async function listTypescriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypescriptFiles(path));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files.sort();
}
