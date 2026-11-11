// Runs the Durable Object SQLite conformance suite (tests/workerd) inside workerd with a
// local Miniflare instance. No Cloudflare account, network access, or secrets needed.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare } from "miniflare";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = await mkdtemp(join(tmpdir(), "chimpbase-workerd-"));
const scriptPath = join(outDir, "worker.js");

await build({
  bundle: true,
  conditions: ["workerd", "worker", "browser"],
  entryPoints: [resolve(repoRoot, "tests/workerd/worker.ts")],
  external: ["node:*", "cloudflare:*"],
  format: "esm",
  logLevel: "warning",
  outfile: scriptPath,
  platform: "neutral",
  target: "es2022",
  tsconfig: resolve(repoRoot, "tsconfig.json"),
});

const mf = new Miniflare({
  compatibilityDate: "2026-04-01",
  compatibilityFlags: ["nodejs_compat"],
  durableObjects: {
    DO_SQLITE_SUITE: { className: "ChimpbaseDoSqliteSuite", useSQLite: true },
  },
  modules: true,
  modulesRoot: outDir,
  scriptPath,
});

const cases = await (await mf.dispatchFetch("http://suite.local/cases")).json();

describe("Durable Object SQLite adapter (workerd)", () => {
  before(async () => {
    await mf.ready;
  });

  after(async () => {
    await mf.dispose();
    await rm(outDir, { force: true, recursive: true });
  });

  for (const name of cases) {
    test(name, async () => {
      const response = await mf.dispatchFetch(`http://suite.local/run?case=${encodeURIComponent(name)}`);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error);
    });
  }
});
