import { mkdtemp, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = resolve(import.meta.dir, "../../../../../");
const sourceProjectDir = resolve(repoRoot, "examples/bun/todo-ts-nestjs");
const chimpbaseBunPackageDir = resolve(repoRoot, "packages/bun");
const chimpbaseHostPackageDir = resolve(repoRoot, "packages/host");
const chimpbasePostgresPackageDir = resolve(repoRoot, "packages/postgres");
const chimpbaseToolingPackageDir = resolve(repoRoot, "packages/tooling");
const chimpbaseCorePackageDir = resolve(repoRoot, "packages/core");
const runtimePackageDir = resolve(repoRoot, "packages/runtime");

interface ProjectFixture {
  cleanup(): Promise<void>;
  port: number;
  projectDir: string;
}

interface RunningServer {
  stop(): Promise<void>;
  url: string;
}

export async function createProjectFixture(label: string): Promise<ProjectFixture> {
  const projectDir = await mkdtemp(join(tmpdir(), `chimpbase-todo-ts-nestjs-${label}-`));
  const port = await reservePort();

  await cp(resolve(sourceProjectDir, "src"), resolve(projectDir, "src"), { recursive: true });
  await cp(resolve(sourceProjectDir, "migrations"), resolve(projectDir, "migrations"), {
    recursive: true,
  });

  await cp(resolve(sourceProjectDir, "action.ts"), resolve(projectDir, "action.ts"));
  await cp(resolve(sourceProjectDir, "app.ts"), resolve(projectDir, "app.ts"));
  await cp(resolve(sourceProjectDir, "chimpbase.migrations.ts"), resolve(projectDir, "chimpbase.migrations.ts"));
  await cp(resolve(sourceProjectDir, "tsconfig.json"), resolve(projectDir, "tsconfig.json"));
  await writeFile(
    resolve(projectDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        dependencies: {
          "@nestjs/common": "^11.1.5",
          "@nestjs/core": "^11.1.5",
          hono: "^4.12.5",
          kysely: "^0.28.11",
          pg: "^8.16.3",
          "pg-cloudflare": "^1.2.7",
          "pg-connection-string": "^2.9.1",
          "pg-int8": "^1.0.1",
          "pg-pool": "^3.10.1",
          "pg-protocol": "^1.10.3",
          "pg-types": "^4.1.0",
          pgpass: "^1.0.5",
          "postgres-array": "^3.0.4",
          "postgres-bytea": "^3.0.0",
          "postgres-date": "^2.1.0",
          "postgres-interval": "^4.0.2",
          "reflect-metadata": "^0.2.2",
          rxjs: "^7.8.2",
          split2: "^4.2.0",
          tslib: "^2.8.1",
          xtend: "^4.0.2",
        },
        scripts: {
          action: "bun run action.ts",
          dev: "bun run app.ts",
          test: "bun test",
          "test:app": "bun test tests/app",
          "test:e2e": "bun test tests/e2e",
        },
      },
      null,
      2,
    ),
  );

  await installFixtureDependencies(projectDir);

  await mkdir(resolve(projectDir, "node_modules/@chimpbase"), { recursive: true });
  await cp(runtimePackageDir, resolve(projectDir, "node_modules/@chimpbase/runtime"), {
    recursive: true, filter: skipNodeModulesAndDist,
  });
  await rewriteExportsToSource(resolve(projectDir, "node_modules/@chimpbase/runtime"), "./index.ts");
  await cp(chimpbaseCorePackageDir, resolve(projectDir, "node_modules/@chimpbase/core"), {
    recursive: true, filter: skipNodeModulesAndDist,
  });
  await rewriteExportsToSource(resolve(projectDir, "node_modules/@chimpbase/core"), "./index.ts");
  await cp(chimpbaseHostPackageDir, resolve(projectDir, "node_modules/@chimpbase/host"), {
    recursive: true, filter: skipNodeModulesAndDist,
  });
  await rewriteExportsToSource(resolve(projectDir, "node_modules/@chimpbase/host"));
  await cp(resolve(chimpbaseBunPackageDir, "src"), resolve(projectDir, "node_modules/@chimpbase/bun/src"), {
    recursive: true,
  });
  await cp(resolve(chimpbaseBunPackageDir, "package.json"), resolve(projectDir, "node_modules/@chimpbase/bun/package.json"));
  await copyDirectoryIfExists(resolve(chimpbaseBunPackageDir, "dist"), resolve(projectDir, "node_modules/@chimpbase/bun/dist"));
  await rewriteExportsToSource(resolve(projectDir, "node_modules/@chimpbase/bun"), "./src/library.ts");
  await cp(resolve(chimpbasePostgresPackageDir, "src"), resolve(projectDir, "node_modules/@chimpbase/postgres/src"), {
    recursive: true,
  });
  await cp(resolve(chimpbasePostgresPackageDir, "package.json"), resolve(projectDir, "node_modules/@chimpbase/postgres/package.json"));
  await copyDirectoryIfExists(resolve(chimpbasePostgresPackageDir, "dist"), resolve(projectDir, "node_modules/@chimpbase/postgres/dist"));
  await rewriteExportsToSource(resolve(projectDir, "node_modules/@chimpbase/postgres"));
  await cp(resolve(chimpbaseToolingPackageDir, "src"), resolve(projectDir, "node_modules/@chimpbase/tooling/src"), {
    recursive: true,
  });
  await cp(resolve(chimpbaseToolingPackageDir, "package.json"), resolve(projectDir, "node_modules/@chimpbase/tooling/package.json"));
  await copyDirectoryIfExists(resolve(chimpbaseToolingPackageDir, "dist"), resolve(projectDir, "node_modules/@chimpbase/tooling/dist"));
  await rewriteExportsToSource(resolve(projectDir, "node_modules/@chimpbase/tooling"));

  await mkdir(resolve(projectDir, "data"), { recursive: true });

  return {
    port,
    projectDir,
    async cleanup() {
      await rm(projectDir, { recursive: true, force: true });
    },
  };
}

export async function runAction(
  projectDir: string,
  actionName: string,
  args: unknown[] = [],
  envOverrides: Record<string, string> = {},
): Promise<string> {
  const process = Bun.spawn(
    [
      "bun",
      "run",
      "action.ts",
      actionName,
      JSON.stringify(args),
    ],
    {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      env: processEnv(envOverrides),
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`action ${actionName} failed\n${stdout}\n${stderr}`);
  }

  return stdout;
}

export async function startServer(
  projectDir: string,
  port: number,
  envOverrides: Record<string, string> = {},
): Promise<RunningServer> {
  const process = Bun.spawn(
    [
      "bun",
      "run",
      "app.ts",
    ],
    {
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      env: processEnv({
        PORT: String(port),
        ...envOverrides,
      }),
    },
  );

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHealthyServer(url);
  } catch (error) {
    process.kill();
    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    throw new Error(`server failed to start: ${String(error)}\n${stdout}\n${stderr}`);
  }

  return {
    url,
    async stop() {
      process.kill();
      await process.exited;
    },
  };
}

function processEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...process.env,
    BUN_FORCE_COLOR: "0",
    ...overrides,
  };
}

async function waitForHealthyServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
    }

    await Bun.sleep(250);
  }

  throw new Error(`health check timed out for ${url}`);
}

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to resolve ephemeral port")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePort(port);
      });
    });
  });
}

async function installFixtureDependencies(projectDir: string): Promise<void> {
  const process = Bun.spawn(["bun", "install"], {
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`fixture install failed\n${stdout}\n${stderr}`);
  }
}

function skipNodeModulesAndDist(source: string): boolean {
  const name = basename(source);
  return name !== "node_modules" && name !== "dist";
}

async function copyDirectoryIfExists(sourceDir: string, targetDir: string): Promise<void> {
  try {
    await cp(sourceDir, targetDir, { recursive: true });
  } catch {
  }
}

async function rewriteExportsToSource(packageDir: string, mainSourcePath?: string): Promise<void> {
  const packageJsonPath = resolve(packageDir, "package.json");
  try {
    const pkg = JSON.parse(await Bun.file(packageJsonPath).text());
    if (!pkg.exports) return;
    let changed = false;
    for (const [key, value] of Object.entries(pkg.exports)) {
      const entry = value as { import?: string; types?: string; default?: string };
      if (entry.import?.includes("/dist/")) {
        const sourcePath = key === "." && mainSourcePath
          ? mainSourcePath
          : entry.import.replace(/\.\/dist\/src\//, "./src/").replace(/\.js$/, ".ts");
        pkg.exports[key] = { types: sourcePath, import: sourcePath, default: sourcePath };
        changed = true;
      }
    }
    if (changed) {
      await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2));
    }
  } catch {
  }
}
