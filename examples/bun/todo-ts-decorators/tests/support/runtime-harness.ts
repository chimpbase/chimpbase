import { mkdtemp, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = resolve(import.meta.dir, "../../../../../");
const sourceProjectDir = resolve(repoRoot, "examples/bun/todo-ts-decorators");
const chimpbaseBunPackageDir = resolve(repoRoot, "packages/bun");
const chimpbasePostgresPackageDir = resolve(repoRoot, "packages/postgres");
const chimpbaseToolingPackageDir = resolve(repoRoot, "packages/tooling");
const workspaceNodeModulesDir = resolve(repoRoot, "node_modules");
const chimpbaseCorePackageDir = resolve(repoRoot, "packages/core");
const runtimePackageDir = resolve(repoRoot, "packages/runtime");
const bunRuntimeDependencies = [
  "kysely",
  "pg",
  "pg-cloudflare",
  "pg-connection-string",
  "pg-pool",
  "pg-protocol",
  "pg-types",
  "pgpass",
  "split2",
  "pg-int8",
  "postgres-array",
  "postgres-bytea",
  "postgres-date",
  "postgres-interval",
  "xtend",
];

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
  const projectDir = await mkdtemp(join(tmpdir(), `chimpbase-todo-ts-decorators-${label}-`));
  const port = await reservePort();

  await cp(resolve(sourceProjectDir, "src"), resolve(projectDir, "src"), { recursive: true });
  await cp(resolve(sourceProjectDir, "migrations"), resolve(projectDir, "migrations"), {
    recursive: true,
  });

  await cp(resolve(sourceProjectDir, "action.ts"), resolve(projectDir, "action.ts"));
  await cp(resolve(sourceProjectDir, "app.ts"), resolve(projectDir, "app.ts"));
  await cp(resolve(sourceProjectDir, "chimpbase.app.ts"), resolve(projectDir, "chimpbase.app.ts"));
  await cp(resolve(sourceProjectDir, "chimpbase.migrations.ts"), resolve(projectDir, "chimpbase.migrations.ts"));
  await cp(resolve(sourceProjectDir, "tsconfig.json"), resolve(projectDir, "tsconfig.json"));
  await writeFile(
    resolve(projectDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        dependencies: {
          "@chimpbase/core": "file:./node_modules/@chimpbase/core",
          "@chimpbase/runtime": "file:./node_modules/@chimpbase/runtime",
          "@chimpbase/bun": "file:./node_modules/@chimpbase/bun",
          "@chimpbase/tooling": "file:./node_modules/@chimpbase/tooling",
          hono: "^4.12.5",
          kysely: "^0.28.11",
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

  try {
    await mkdir(resolve(projectDir, "node_modules"), { recursive: true });
    await cp(runtimePackageDir, resolve(projectDir, "node_modules/@chimpbase/runtime"), {
      recursive: true,
    });
    await cp(chimpbaseCorePackageDir, resolve(projectDir, "node_modules/@chimpbase/core"), {
      recursive: true,
    });
    await cp(resolve(chimpbaseBunPackageDir, "src"), resolve(projectDir, "node_modules/@chimpbase/bun/src"), {
      recursive: true,
    });
    await cp(resolve(chimpbaseBunPackageDir, "package.json"), resolve(projectDir, "node_modules/@chimpbase/bun/package.json"));
    await cp(resolve(chimpbasePostgresPackageDir, "src"), resolve(projectDir, "node_modules/@chimpbase/postgres/src"), {
      recursive: true,
    });
    await cp(resolve(chimpbasePostgresPackageDir, "package.json"), resolve(projectDir, "node_modules/@chimpbase/postgres/package.json"));
    await cp(resolve(chimpbaseToolingPackageDir, "src"), resolve(projectDir, "node_modules/@chimpbase/tooling/src"), {
      recursive: true,
    });
    await cp(resolve(chimpbaseToolingPackageDir, "package.json"), resolve(projectDir, "node_modules/@chimpbase/tooling/package.json"));

    await cp(resolve(workspaceNodeModulesDir, "hono"), resolve(projectDir, "node_modules", "hono"), {
      recursive: true,
    });

    for (const dependency of bunRuntimeDependencies) {
      await cp(
        resolve(workspaceNodeModulesDir, dependency),
        resolve(projectDir, "node_modules", dependency),
        { recursive: true },
      );
    }
  } catch {
  }

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
