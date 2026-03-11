import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { Pool, type PoolClient } from "pg";

import type {
  ChimpbaseEngineAdapter,
  ChimpbaseEventRecord,
  ChimpbaseProjectConfig,
  ChimpbaseQueueJobRecord,
} from "@chimpbase/core";
import type {
  ChimpbaseCollectionFilter,
  ChimpbaseCollectionFindOptions,
  ChimpbaseCollectionPatch,
  ChimpbaseKvListOptions,
  ChimpbaseQueueSendOptions,
  ChimpbaseStreamEvent,
  ChimpbaseStreamReadOptions,
} from "@chimpbase/runtime";

interface PersistedCollectionDocument {
  document_id: string;
  document_json: string;
}

type Queryable = Pool | PoolClient;

export function openPostgresPool(config: ChimpbaseProjectConfig): Pool {
  if (!config.storage.url) {
    throw new Error("postgres storage requires storage.url");
  }

  return new Pool({
    connectionString: config.storage.url,
  });
}

export async function applyPostgresSqlMigrations(
  pool: Pool,
  migrationsDir: string | null,
): Promise<void> {
  if (!migrationsDir) {
    return;
  }

  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return;
  }

  const migrations = entries
    .filter((entry) => extname(entry) === ".sql")
    .sort();

  for (const migration of migrations) {
    const sql = await Bun.file(resolve(migrationsDir, migration)).text();
    await pool.query(sql);
  }
}

export async function applyInlinePostgresMigrations(pool: Pool, migrations: string[]): Promise<void> {
  for (const migration of migrations) {
    await pool.query(migration);
  }
}

export async function ensurePostgresInternalTables(pool: Pool): Promise<void> {
  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_events (
        id BIGSERIAL PRIMARY KEY,
        event_name TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  );

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_kv (
        key TEXT PRIMARY KEY,
        value_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  );

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_collections (
        collection_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection_name, document_id)
      )
    `,
  );

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_stream_events (
        id BIGSERIAL PRIMARY KEY,
        stream_name TEXT NOT NULL,
        event_name TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  );

  await pool.query(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_queue_jobs (
        id BIGSERIAL PRIMARY KEY,
        queue_name TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        status TEXT NOT NULL,
        available_at_ms BIGINT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        lease_expires_at_ms BIGINT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `,
  );
}

export function createPostgresEngineAdapter(pool: Pool): ChimpbaseEngineAdapter {
  let transactionClient: PoolClient | null = null;

  const queryable = (): Queryable => transactionClient ?? pool;

  return {
    async beginTransaction() {
      if (transactionClient) {
        return;
      }

      transactionClient = await pool.connect();
      await transactionClient.query("BEGIN");
    },
    async claimNextQueueJob(leaseMs: number): Promise<ChimpbaseQueueJobRecord | null> {
      const now = Date.now();
      const leaseExpiresAtMs = now + leaseMs;
      const result = await queryable().query<ChimpbaseQueueJobRecord>(
        `
          WITH candidate AS (
            SELECT id
            FROM _chimpbase_queue_jobs
            WHERE (
              status = 'pending' AND available_at_ms <= $1
            ) OR (
              status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= $1
            )
            ORDER BY id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE _chimpbase_queue_jobs q
          SET
            status = 'processing',
            attempt_count = q.attempt_count + 1,
            lease_expires_at_ms = $2,
            updated_at = NOW()
          FROM candidate
          WHERE q.id = candidate.id
          RETURNING q.id, q.queue_name, q.payload_json::text, q.attempt_count
        `,
        [now, leaseExpiresAtMs],
      );
      return result.rows[0] ?? null;
    },
    async collectionDelete(name: string, filter: ChimpbaseCollectionFilter = {}): Promise<number> {
      const matched = await findCollectionDocuments(queryable(), name, filter);
      for (const row of matched) {
        await queryable().query(
          "DELETE FROM _chimpbase_collections WHERE collection_name = $1 AND document_id = $2",
          [name, row.document_id],
        );
      }
      return matched.length;
    },
    async collectionFind<TDocument = Record<string, unknown>>(
      name: string,
      filter: ChimpbaseCollectionFilter = {},
      options?: ChimpbaseCollectionFindOptions,
    ): Promise<TDocument[]> {
      return (await findCollectionDocuments(queryable(), name, filter, options)).map((row) =>
        JSON.parse(row.document_json) as TDocument
      );
    },
    async collectionFindOne<TDocument = Record<string, unknown>>(
      name: string,
      filter: ChimpbaseCollectionFilter,
    ): Promise<TDocument | null> {
      const [row] = await findCollectionDocuments(queryable(), name, filter, { limit: 1 });
      return row ? JSON.parse(row.document_json) as TDocument : null;
    },
    async collectionInsert<TDocument extends Record<string, unknown>>(name: string, document: TDocument): Promise<string> {
      const documentId = crypto.randomUUID();
      await queryable().query(
        `
          INSERT INTO _chimpbase_collections (
            collection_name,
            document_id,
            document_json,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3::jsonb, NOW(), NOW())
        `,
        [name, documentId, JSON.stringify({ ...document, id: documentId })],
      );
      return documentId;
    },
    async collectionList(): Promise<string[]> {
      const result = await queryable().query<{ collection_name: string }>(
        `
          SELECT DISTINCT collection_name
          FROM _chimpbase_collections
          ORDER BY collection_name ASC
        `,
      );
      return result.rows.map((row) => row.collection_name);
    },
    async collectionUpdate(name: string, filter: ChimpbaseCollectionFilter, patch: ChimpbaseCollectionPatch): Promise<number> {
      const matched = await findCollectionDocuments(queryable(), name, filter);
      for (const row of matched) {
        const current = JSON.parse(row.document_json) as Record<string, unknown>;
        await queryable().query(
          `
            UPDATE _chimpbase_collections
            SET document_json = $1::jsonb, updated_at = NOW()
            WHERE collection_name = $2 AND document_id = $3
          `,
          [JSON.stringify({ ...current, ...patch }), name, row.document_id],
        );
      }
      return matched.length;
    },
    async commitTransaction(events: ChimpbaseEventRecord[]) {
      await persistEvents(queryable(), events);
      if (transactionClient) {
        await transactionClient.query("COMMIT");
        transactionClient.release();
        transactionClient = null;
      }
    },
    async completeQueueJob(jobId: number) {
      await queryable().query(
        `
          UPDATE _chimpbase_queue_jobs
          SET
            status = 'completed',
            completed_at = NOW(),
            lease_expires_at_ms = NULL,
            updated_at = NOW()
          WHERE id = $1
        `,
        [jobId],
      );
    },
    async getQueueJobPayload(jobId: number): Promise<string | null> {
      const result = await queryable().query<{ payload_json: string }>(
        "SELECT payload_json::text AS payload_json FROM _chimpbase_queue_jobs WHERE id = $1 LIMIT 1",
        [jobId],
      );
      return result.rows[0]?.payload_json ?? null;
    },
    async kvDelete(key: string) {
      await queryable().query("DELETE FROM _chimpbase_kv WHERE key = $1", [key]);
    },
    async kvGet<TValue = unknown>(key: string): Promise<TValue | null> {
      const result = await queryable().query<{ value_json: string }>(
        "SELECT value_json::text AS value_json FROM _chimpbase_kv WHERE key = $1 LIMIT 1",
        [key],
      );
      const row = result.rows[0];
      return row ? JSON.parse(row.value_json) as TValue : null;
    },
    async kvList(options?: ChimpbaseKvListOptions): Promise<string[]> {
      const prefix = options?.prefix ?? "";
      const result = await queryable().query<{ key: string }>(
        `
          SELECT key
          FROM _chimpbase_kv
          WHERE key LIKE $1
          ORDER BY key ASC
        `,
        [`${prefix}%`],
      );
      return result.rows.map((row) => row.key);
    },
    async kvSet<TValue = unknown>(key: string, value: TValue) {
      await queryable().query(
        `
          INSERT INTO _chimpbase_kv (key, value_json, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = NOW()
        `,
        [key, JSON.stringify(value ?? null)],
      );
    },
    async markQueueJobFailure(
      jobId: number,
      status: "dlq" | "failed" | "pending",
      nextAvailableAtMs: number,
      errorMessage: string,
    ) {
      await queryable().query(
        `
          UPDATE _chimpbase_queue_jobs
          SET
            status = $1,
            available_at_ms = $2,
            lease_expires_at_ms = NULL,
            last_error = $3,
            updated_at = NOW()
          WHERE id = $4
        `,
        [status, nextAvailableAtMs, errorMessage, jobId],
      );
    },
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await queryable().query(normalizePostgresSql(sql), [...params]);
      return result.rows as T[];
    },
    async queueSend<TPayload = unknown>(name: string, payload: TPayload, options?: ChimpbaseQueueSendOptions) {
      const availableAtMs = Date.now() + Math.max(0, options?.delayMs ?? 0);
      await queryable().query(
        `
          INSERT INTO _chimpbase_queue_jobs (
            queue_name,
            payload_json,
            status,
            available_at_ms,
            attempt_count
          ) VALUES ($1, $2::jsonb, 'pending', $3, 0)
        `,
        [name, JSON.stringify(payload ?? null), availableAtMs],
      );
    },
    async rollbackTransaction() {
      if (!transactionClient) {
        return;
      }

      try {
        await transactionClient.query("ROLLBACK");
      } finally {
        transactionClient.release();
        transactionClient = null;
      }
    },
    secret(name: string): string | null {
      return process.env[name] ?? null;
    },
    async streamPublish<TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number> {
      const result = await queryable().query<{ id: number }>(
        `
          INSERT INTO _chimpbase_stream_events (
            stream_name,
            event_name,
            payload_json
          ) VALUES ($1, $2, $3::jsonb)
          RETURNING id
        `,
        [stream, event, JSON.stringify(payload ?? null)],
      );
      return result.rows[0]?.id ?? 0;
    },
    async streamRead<TPayload = unknown>(
      stream: string,
      options?: ChimpbaseStreamReadOptions,
    ): Promise<ChimpbaseStreamEvent<TPayload>[]> {
      const sinceId = options?.sinceId ?? 0;
      const limit = options?.limit ?? 100;
      const result = await queryable().query<{
        created_at: string;
        event_name: string;
        id: number;
        payload_json: string;
        stream_name: string;
      }>(
        `
          SELECT
            id,
            stream_name,
            event_name,
            payload_json::text AS payload_json,
            created_at::text AS created_at
          FROM _chimpbase_stream_events
          WHERE stream_name = $1 AND id > $2
          ORDER BY id ASC
          LIMIT $3
        `,
        [stream, sinceId, limit],
      );

      return result.rows.map((row) => ({
        createdAt: row.created_at,
        event: row.event_name,
        id: row.id,
        payload: JSON.parse(row.payload_json) as TPayload,
        stream: row.stream_name,
      }));
    },
  };
}

function normalizePostgresSql(sql: string): string {
  return sql.replace(/\?(\d+)/g, (_match, index) => `$${index}`);
}

async function persistEvents(queryable: Queryable, events: ChimpbaseEventRecord[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  for (const event of events) {
    await queryable.query(
      "INSERT INTO _chimpbase_events (event_name, payload_json) VALUES ($1, $2::jsonb)",
      [event.name, event.payloadJson],
    );
  }
}

async function findCollectionDocuments(
  queryable: Queryable,
  name: string,
  filter: ChimpbaseCollectionFilter = {},
  options?: ChimpbaseCollectionFindOptions,
): Promise<PersistedCollectionDocument[]> {
  const result = await queryable.query<PersistedCollectionDocument>(
    `
      SELECT
        document_id,
        document_json::text AS document_json
      FROM _chimpbase_collections
      WHERE collection_name = $1
      ORDER BY document_id ASC
    `,
    [name],
  );

  const matched = result.rows.filter((row) => {
    const document = JSON.parse(row.document_json) as Record<string, unknown>;
    return Object.entries(filter).every(([key, value]) => document[key] === value);
  });

  const limit = options?.limit;
  return typeof limit === "number" ? matched.slice(0, limit) : matched;
}
