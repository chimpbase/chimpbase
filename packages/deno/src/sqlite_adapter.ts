import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CompiledQuery, Kysely, QueryResult } from "kysely";

import type {
  ChimpbaseEngineAdapter,
  ChimpbaseEventRecord,
  ChimpbasePlatformShim,
  ChimpbaseProjectConfig,
  ChimpbaseQueueJobRecord,
} from "@chimpbase/core";
import type {
  ChimpbaseCollectionFilter,
  ChimpbaseCollectionFindOptions,
  ChimpbaseCollectionPatch,
  ChimpbaseKvListOptions,
  ChimpbaseQueueEnqueueOptions,
  ChimpbaseStreamEvent,
  ChimpbaseStreamReadOptions,
} from "@chimpbase/runtime";

import { createSqliteKysely } from "./kysely.ts";

type SqliteBinding = unknown;

interface RawSqliteStatement {
  all(params?: SqliteBinding[]): unknown[];
  run(params?: SqliteBinding[]): SqliteRunResult | bigint | number | void;
}

interface RawSqliteDatabase {
  close(): void;
  exec(sql: string): unknown;
  prepare(sql: string): RawSqliteStatement;
}

interface SqliteRunResult {
  changes: number;
  lastInsertRowid?: bigint | number;
}

interface SqliteStatement {
  readonly reader: boolean;
  all(...params: SqliteBinding[]): unknown[];
  run(...params: SqliteBinding[]): SqliteRunResult;
}

interface SqliteDatabase {
  close(): void;
  exec(sql: string): unknown;
  query(sql: string): SqliteStatement;
}

interface PersistedCollectionDocument {
  document_id: string;
  document_json: string;
}

interface PersistedCronScheduleRow {
  cron_expression: string;
  next_fire_at_ms: number;
  schedule_name: string;
}

export async function openSqliteDatabase(
  projectDir: string,
  config: ChimpbaseProjectConfig,
): Promise<SqliteDatabase> {
  const DatabaseConstructor = await loadSqliteDatabaseConstructor();

  if (config.storage.engine === "memory" || !config.storage.path || config.storage.path === ":memory:") {
    return createSqliteDatabase(new DatabaseConstructor(":memory:"));
  }

  const databasePath = resolve(projectDir, config.storage.path);
  await mkdir(dirname(databasePath), { recursive: true });
  return createSqliteDatabase(new DatabaseConstructor(databasePath));
}

export async function applySqlMigrations(db: SqliteDatabase, migrations: readonly string[]): Promise<void> {
  for (const migration of migrations) {
    db.exec(migration);
  }
}

export async function applyInlineSqlMigrations(db: SqliteDatabase, migrations: string[]): Promise<void> {
  for (const migration of migrations) {
    db.exec(migration);
  }
}

export async function ensureSqliteInternalTables(db: SqliteDatabase): Promise<void> {
  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_events (
        id INTEGER PRIMARY KEY,
        event_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_kv (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_collections (
        collection_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection_name, document_id)
      );
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_stream_events (
        id INTEGER PRIMARY KEY,
        stream_name TEXT NOT NULL,
        event_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_queue_jobs (
        id INTEGER PRIMARY KEY,
        queue_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at_ms INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        lease_expires_at_ms INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );
    `,
  );

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_chimpbase_queue_jobs_pending_due
      ON _chimpbase_queue_jobs(status, available_at_ms, id);
    `,
  );

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_chimpbase_queue_jobs_processing_due
      ON _chimpbase_queue_jobs(status, lease_expires_at_ms, id);
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_cron_schedules (
        schedule_name TEXT PRIMARY KEY,
        cron_expression TEXT NOT NULL,
        next_fire_at_ms INTEGER NOT NULL,
        lease_token TEXT,
        lease_expires_at_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  );

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_chimpbase_cron_schedules_due
      ON _chimpbase_cron_schedules(next_fire_at_ms, lease_expires_at_ms);
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_cron_runs (
        schedule_name TEXT NOT NULL,
        fire_at_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (schedule_name, fire_at_ms)
      );
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_workflow_instances (
        workflow_id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        current_step_id TEXT,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        wake_at_ms INTEGER,
        last_error TEXT,
        lease_token TEXT,
        lease_expires_at_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      );
    `,
  );

  try {
    db.exec("ALTER TABLE _chimpbase_workflow_instances ADD COLUMN current_step_id TEXT");
  } catch {
    // Column already exists on upgraded databases.
  }

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_chimpbase_workflow_instances_status
      ON _chimpbase_workflow_instances(status, wake_at_ms);
    `,
  );

  db.exec(
    `
      CREATE TABLE IF NOT EXISTS _chimpbase_workflow_signals (
        id INTEGER PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        signal_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  );

  db.exec(
    `
      CREATE INDEX IF NOT EXISTS idx_chimpbase_workflow_signals_pending
      ON _chimpbase_workflow_signals(workflow_id, signal_name, consumed_at, id);
    `,
  );
}

export function createSqliteEngineAdapter(
  db: SqliteDatabase,
  platform: ChimpbasePlatformShim,
): ChimpbaseEngineAdapter {
  let kysely: Kysely<any> | null = null;

  return {
    async advanceCronSchedule(
      scheduleName: string,
      fireAtMs: number,
      nextFireAtMs: number,
      leaseToken: string,
    ) {
      const result = db.query(
        `
          UPDATE _chimpbase_cron_schedules
          SET
            next_fire_at_ms = ?1,
            lease_token = NULL,
            lease_expires_at_ms = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE schedule_name = ?2
            AND next_fire_at_ms = ?3
            AND lease_token = ?4
        `,
      ).run(nextFireAtMs, scheduleName, fireAtMs, leaseToken);

      if (result.changes === 0) {
        throw new Error(`cron schedule advance failed: ${scheduleName}`);
      }
    },
    async beginTransaction() {
      db.exec("BEGIN IMMEDIATE");
    },
    async claimNextCronSchedule(leaseMs: number): Promise<(PersistedCronScheduleRow & { lease_token: string }) | null> {
      const now = platform.now();
      const leaseToken = platform.randomUUID();
      const leaseExpiresAtMs = now + leaseMs;

      db.exec("BEGIN IMMEDIATE");
      try {
        const [schedule] = db.query(
          `
            SELECT
              schedule_name,
              cron_expression,
              next_fire_at_ms
            FROM _chimpbase_cron_schedules
            WHERE next_fire_at_ms <= ?1
              AND (
                lease_token IS NULL
                OR lease_expires_at_ms IS NULL
                OR lease_expires_at_ms <= ?1
              )
            ORDER BY next_fire_at_ms ASC, schedule_name ASC
            LIMIT 1
          `,
        ).all(now) as PersistedCronScheduleRow[];

        if (!schedule) {
          db.exec("COMMIT");
          return null;
        }

        const result = db.query(
          `
            UPDATE _chimpbase_cron_schedules
            SET
              lease_token = ?1,
              lease_expires_at_ms = ?2,
              updated_at = CURRENT_TIMESTAMP
            WHERE schedule_name = ?3
              AND next_fire_at_ms = ?4
              AND (
                lease_token IS NULL
                OR lease_expires_at_ms IS NULL
                OR lease_expires_at_ms <= ?5
              )
          `,
        ).run(leaseToken, leaseExpiresAtMs, schedule.schedule_name, schedule.next_fire_at_ms, now);

        if (result.changes === 0) {
          db.exec("COMMIT");
          return null;
        }

        db.exec("COMMIT");
        return {
          ...schedule,
          lease_token: leaseToken,
        };
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }

        throw error;
      }
    },
    async claimNextQueueJob(leaseMs: number): Promise<ChimpbaseQueueJobRecord | null> {
      const now = platform.now();
      const leaseExpiresAtMs = now + leaseMs;

      db.exec("BEGIN IMMEDIATE");
      try {
        const [job] = db.query(
          `
            SELECT
              id,
              queue_name,
              payload_json,
              attempt_count
            FROM _chimpbase_queue_jobs
            WHERE (
              status = 'pending' AND available_at_ms <= ?1
            ) OR (
              status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?1
            )
            ORDER BY id ASC
            LIMIT 1
          `,
        ).all(now) as ChimpbaseQueueJobRecord[];

        if (!job) {
          db.exec("COMMIT");
          return null;
        }

        db.query(
          `
            UPDATE _chimpbase_queue_jobs
            SET
              status = 'processing',
              attempt_count = attempt_count + 1,
              lease_expires_at_ms = ?1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?2
          `,
        ).run(leaseExpiresAtMs, job.id);

        db.exec("COMMIT");
        return {
          ...job,
          attempt_count: job.attempt_count + 1,
        };
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }

        throw error;
      }
    },
    async collectionDelete(name: string, filter: ChimpbaseCollectionFilter = {}): Promise<number> {
      const matched = findCollectionDocuments(db, name, filter);
      for (const row of matched) {
        db.query(
          "DELETE FROM _chimpbase_collections WHERE collection_name = ?1 AND document_id = ?2",
        ).run(name, row.document_id);
      }
      return matched.length;
    },
    async collectionFind<TDocument = Record<string, unknown>>(
      name: string,
      filter: ChimpbaseCollectionFilter = {},
      options?: ChimpbaseCollectionFindOptions,
    ): Promise<TDocument[]> {
      return findCollectionDocuments(db, name, filter, options).map((row) =>
        JSON.parse(row.document_json) as TDocument
      );
    },
    async collectionFindOne<TDocument = Record<string, unknown>>(
      name: string,
      filter: ChimpbaseCollectionFilter,
    ): Promise<TDocument | null> {
      const [row] = findCollectionDocuments(db, name, filter, { limit: 1 });
      return row ? JSON.parse(row.document_json) as TDocument : null;
    },
    async collectionInsert<TDocument extends Record<string, unknown>>(name: string, document: TDocument): Promise<string> {
      const documentId = platform.randomUUID();
      const payload = JSON.stringify({ ...document, id: documentId });
      db.query(
        `
          INSERT INTO _chimpbase_collections (
            collection_name,
            document_id,
            document_json,
            created_at,
            updated_at
          ) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      ).run(name, documentId, payload);
      return documentId;
    },
    async collectionList(): Promise<string[]> {
      const rows = db.query(
        `
          SELECT DISTINCT collection_name
          FROM _chimpbase_collections
          ORDER BY collection_name ASC
        `,
      ).all() as Array<{ collection_name: string }>;
      return rows.map((row) => row.collection_name);
    },
    async collectionUpdate(name: string, filter: ChimpbaseCollectionFilter, patch: ChimpbaseCollectionPatch): Promise<number> {
      const matched = findCollectionDocuments(db, name, filter);
      for (const row of matched) {
        const current = JSON.parse(row.document_json) as Record<string, unknown>;
        const next = JSON.stringify({ ...current, ...patch });
        db.query(
          `
            UPDATE _chimpbase_collections
            SET document_json = ?1, updated_at = CURRENT_TIMESTAMP
            WHERE collection_name = ?2 AND document_id = ?3
          `,
        ).run(next, name, row.document_id);
      }
      return matched.length;
    },
    async commitTransaction(events: ChimpbaseEventRecord[]) {
      persistEvents(db, events);
      db.exec("COMMIT");
    },
    async completeQueueJob(jobId: number) {
      db.query(
        `
          UPDATE _chimpbase_queue_jobs
          SET
            status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            lease_expires_at_ms = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1
        `,
      ).run(jobId);
    },
    async deleteCronSchedule(scheduleName: string): Promise<void> {
      db.query(
        "DELETE FROM _chimpbase_cron_schedules WHERE schedule_name = ?1",
      ).run(scheduleName);
    },
    async getQueueJobPayload(jobId: number): Promise<string | null> {
      const [job] = db.query(
        "SELECT payload_json FROM _chimpbase_queue_jobs WHERE id = ?1 LIMIT 1",
      ).all(jobId) as Array<{ payload_json: string }>;
      return job?.payload_json ?? null;
    },
    async insertCronRun(scheduleName: string, fireAtMs: number): Promise<boolean> {
      const result = db.query(
        `
          INSERT OR IGNORE INTO _chimpbase_cron_runs (
            schedule_name,
            fire_at_ms
          ) VALUES (?1, ?2)
        `,
      ).run(scheduleName, fireAtMs);

      return result.changes > 0;
    },
    async kvDelete(key: string) {
      db.query("DELETE FROM _chimpbase_kv WHERE key = ?1").run(key);
    },
    async kvGet<TValue = unknown>(key: string): Promise<TValue | null> {
      const [row] = db.query(
        `
          SELECT value_json
          FROM _chimpbase_kv
          WHERE key = ?1
          LIMIT 1
        `,
      ).all(key) as Array<{ value_json: string }>;
      return row ? JSON.parse(row.value_json) as TValue : null;
    },
    async kvList(options?: ChimpbaseKvListOptions): Promise<string[]> {
      const prefix = options?.prefix ?? "";
      const rows = db.query(
        `
          SELECT key
          FROM _chimpbase_kv
          WHERE key LIKE ?1
          ORDER BY key ASC
        `,
      ).all(`${prefix}%`) as Array<{ key: string }>;
      return rows.map((row) => row.key);
    },
    async kvSet<TValue = unknown>(key: string, value: TValue) {
      db.query(
        `
          INSERT INTO _chimpbase_kv (key, value_json, updated_at)
          VALUES (?1, ?2, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = CURRENT_TIMESTAMP
        `,
      ).run(key, JSON.stringify(value ?? null));
    },
    async listCronSchedules(): Promise<PersistedCronScheduleRow[]> {
      return db.query(
        `
          SELECT
            schedule_name,
            cron_expression,
            next_fire_at_ms
          FROM _chimpbase_cron_schedules
          ORDER BY schedule_name ASC
        `,
      ).all() as PersistedCronScheduleRow[];
    },
    async markQueueJobFailure(
      jobId: number,
      status: "dlq" | "failed" | "pending",
      nextAvailableAtMs: number,
      errorMessage: string,
    ) {
      db.query(
        `
          UPDATE _chimpbase_queue_jobs
          SET
            status = ?1,
            available_at_ms = ?2,
            lease_expires_at_ms = NULL,
            last_error = ?3,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?4
        `,
      ).run(status, nextAvailableAtMs, errorMessage, jobId);
    },
    createKysely<TDatabase = Record<string, never>>(): Kysely<TDatabase> {
      if (!kysely) {
        kysely = createSqliteKysely({
          executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
            const statement = db.query(compiledQuery.sql);

            if (statement.reader) {
              return Promise.resolve({
                rows: statement.all(...toSqlBindings(compiledQuery.parameters)) as R[],
              });
            }

            const result = statement.run(...toSqlBindings(compiledQuery.parameters));

            return Promise.resolve({
              insertId: result.lastInsertRowid === undefined ? undefined : BigInt(result.lastInsertRowid),
              numAffectedRows: BigInt(result.changes),
              rows: [],
            });
          },
        });
      }

      return kysely as Kysely<TDatabase>;
    },
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return runQuery<T>(db, sql, toSqlBindings(params));
    },
    async queueEnqueue<TPayload = unknown>(name: string, payload: TPayload, options?: ChimpbaseQueueEnqueueOptions) {
      const availableAtMs = platform.now() + Math.max(0, options?.delayMs ?? 0);
      db.query(
        `
          INSERT INTO _chimpbase_queue_jobs (
            queue_name,
            payload_json,
            status,
            available_at_ms,
            attempt_count
          ) VALUES (?1, ?2, 'pending', ?3, 0)
        `,
      ).run(name, JSON.stringify(payload ?? null), availableAtMs);
    },
    async releaseCronScheduleLease(scheduleName: string, leaseToken: string): Promise<void> {
      db.query(
        `
          UPDATE _chimpbase_cron_schedules
          SET
            lease_token = NULL,
            lease_expires_at_ms = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE schedule_name = ?1 AND lease_token = ?2
        `,
      ).run(scheduleName, leaseToken);
    },
    async rollbackTransaction() {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
    },
    async streamAppend<TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number> {
      db.query(
        `
          INSERT INTO _chimpbase_stream_events (
            stream_name,
            event_name,
            payload_json
          ) VALUES (?1, ?2, ?3)
        `,
      ).run(stream, event, JSON.stringify(payload ?? null));

      const [row] = db.query(
        "SELECT last_insert_rowid() AS id",
      ).all() as Array<{ id: number }>;
      return row?.id ?? 0;
    },
    async streamRead<TPayload = unknown>(
      stream: string,
      options?: ChimpbaseStreamReadOptions,
    ): Promise<ChimpbaseStreamEvent<TPayload>[]> {
      const sinceId = options?.sinceId ?? 0;
      const limit = options?.limit ?? 100;
      const rows = db.query(
        `
          SELECT
            id,
            stream_name,
            event_name,
            payload_json,
            created_at
          FROM _chimpbase_stream_events
          WHERE stream_name = ?1 AND id > ?2
          ORDER BY id ASC
          LIMIT ?3
        `,
      ).all(stream, sinceId, limit) as Array<{
        created_at: string;
        event_name: string;
        id: number;
        payload_json: string;
        stream_name: string;
      }>;

      return rows.map((row) => ({
        createdAt: row.created_at,
        event: row.event_name,
        id: row.id,
        payload: JSON.parse(row.payload_json) as TPayload,
        stream: row.stream_name,
      }));
    },
    async upsertCronSchedule(scheduleName: string, cronExpression: string, nextFireAtMs: number): Promise<void> {
      db.query(
        `
          INSERT INTO _chimpbase_cron_schedules (
            schedule_name,
            cron_expression,
            next_fire_at_ms,
            lease_token,
            lease_expires_at_ms
          ) VALUES (?1, ?2, ?3, NULL, NULL)
          ON CONFLICT(schedule_name) DO UPDATE SET
            cron_expression = excluded.cron_expression,
            next_fire_at_ms = excluded.next_fire_at_ms,
            lease_token = NULL,
            lease_expires_at_ms = NULL,
            updated_at = CURRENT_TIMESTAMP
        `,
      ).run(scheduleName, cronExpression, nextFireAtMs);
    },
  };
}

function createSqliteDatabase(db: RawSqliteDatabase): SqliteDatabase {
  return {
    close() {
      db.close();
    },
    exec(sql: string) {
      return db.exec(sql);
    },
    query(sql: string): SqliteStatement {
      const statement = db.prepare(sql);
      return {
        reader: statementProducesRows(sql),
        all(...params: SqliteBinding[]) {
          return params.length === 0 ? statement.all() : statement.all(params);
        },
        run(...params: SqliteBinding[]) {
          const result = params.length === 0 ? statement.run() : statement.run(params);
          return {
            changes: typeof result === "object" && result && "changes" in result
              ? Number(result.changes)
              : typeof result === "bigint" || typeof result === "number"
                ? Number(result)
                : 0,
            lastInsertRowid: typeof result === "object" && result && "lastInsertRowid" in result
              ? result.lastInsertRowid
              : undefined,
          };
        },
      };
    },
  };
}

async function loadSqliteDatabaseConstructor(): Promise<new (path: string) => RawSqliteDatabase> {
  const specifier = "jsr:@db/sqlite";
  const module = await import(specifier) as {
    Database: new (path: string) => RawSqliteDatabase;
  };
  return module.Database;
}

function statementProducesRows(sql: string): boolean {
  const normalized = sql.trimStart().toLowerCase();
  return normalized.startsWith("select")
    || normalized.startsWith("pragma")
    || normalized.startsWith("values")
    || normalized.startsWith("explain")
    || normalized.includes(" returning ");
}

function runQuery<T>(db: SqliteDatabase, sql: string, params: SqliteBinding[]): T[] {
  const statement = db.query(sql);
  if (!statement.reader) {
    statement.run(...params);
    return [];
  }

  return statement.all(...params) as T[];
}

function toSqlBindings(params: readonly unknown[]): SqliteBinding[] {
  return [...params];
}

function persistEvents(db: SqliteDatabase, events: ChimpbaseEventRecord[]): void {
  if (events.length === 0) {
    return;
  }

  const statement = db.query(
    "INSERT INTO _chimpbase_events (event_name, payload_json) VALUES (?1, ?2)",
  );
  for (const event of events) {
    statement.run(event.name, event.payloadJson);
  }
}

function findCollectionDocuments(
  db: SqliteDatabase,
  name: string,
  filter: ChimpbaseCollectionFilter = {},
  options?: ChimpbaseCollectionFindOptions,
): PersistedCollectionDocument[] {
  const rows = db.query(
    `
      SELECT
        document_id,
        document_json
      FROM _chimpbase_collections
      WHERE collection_name = ?1
      ORDER BY document_id ASC
    `,
  ).all(name) as PersistedCollectionDocument[];

  const matched = rows.filter((row) => {
    const document = JSON.parse(row.document_json) as Record<string, unknown>;
    return Object.entries(filter).every(([key, value]) => document[key] === value);
  });

  const limit = options?.limit;
  return typeof limit === "number" ? matched.slice(0, limit) : matched;
}
