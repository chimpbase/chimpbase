import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

import { Client } from "pg";

interface CreateDatabaseResult {
  databaseName: string;
  url: string;
}

export interface PostgresDockerHandle {
  createDatabase(prefix?: string): Promise<CreateDatabaseResult>;
  port: number;
  stop(): Promise<void>;
}

interface StartPostgresDockerOptions {
  image?: string;
}

export async function canUseDocker(): Promise<boolean> {
  const result = Bun.spawnSync(
    ["docker", "ps", "--format", "{{.Names}}"],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  return result.exitCode === 0;
}

export async function startPostgresDocker(
  options: StartPostgresDockerOptions = {},
): Promise<PostgresDockerHandle> {
  const containerName = `chimpbase-postgres-${randomUUID().slice(0, 8)}`;
  const image = options.image ?? "postgres:16-alpine";
  const password = `chimpbase_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const port = await reservePort();
  const user = "chimpbase";

  const runResult = Bun.spawnSync(
    [
      "docker",
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--env",
      "POSTGRES_DB=postgres",
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--env",
      `POSTGRES_USER=${user}`,
      "--publish",
      `127.0.0.1:${port}:5432`,
      image,
    ],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  );

  if (runResult.exitCode !== 0) {
    throw new Error(
      `failed to start postgres container\n${runResult.stdout.toString()}\n${runResult.stderr.toString()}`,
    );
  }

  try {
    await waitForPostgres({
      database: "postgres",
      password,
      port,
      user,
    });
  } catch (error) {
    await stopContainer(containerName);
    throw error;
  }

  return {
    async createDatabase(prefix = "chimpbase"): Promise<CreateDatabaseResult> {
      const databaseName = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const client = new Client({
        database: "postgres",
        host: "127.0.0.1",
        password,
        port,
        user,
      });
      await client.connect();

      try {
        await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
      } finally {
        await client.end();
      }

      return {
        databaseName,
        url: `postgres://${user}:${password}@127.0.0.1:${port}/${databaseName}`,
      };
    },
    port,
    async stop() {
      await stopContainer(containerName);
    },
  };
}

async function stopContainer(containerName: string): Promise<void> {
  Bun.spawnSync(
    ["docker", "rm", "--force", containerName],
    {
      stderr: "pipe",
      stdout: "pipe",
    },
  );
}

async function waitForPostgres(options: {
  database: string;
  password: string;
  port: number;
  user: string;
}): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = Bun.spawnSync(
      [
        "pg_isready",
        "--host",
        "127.0.0.1",
        "--port",
        String(options.port),
        "--username",
        options.user,
        "--dbname",
        options.database,
      ],
      {
        env: {
          ...process.env,
          PGPASSWORD: options.password,
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    if (result.exitCode === 0) {
      return;
    }

    await Bun.sleep(500);
  }

  throw new Error(`postgres container did not become ready on port ${options.port}`);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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
