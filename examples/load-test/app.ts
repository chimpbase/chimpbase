import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createChimpbase, type ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { action, type ChimpbaseWorkerHandler, v, worker } from "@chimpbase/runtime";

type BenchmarkMode = "action" | "queue-burst" | "queue-steady" | "both";
type StorageEngine = "memory" | "postgres" | "sqlite";

interface LoadTestOptions {
  concurrency: number;
  databaseUrl: string | null;
  debug: boolean;
  headroom: number;
  iterations: number;
  mode: BenchmarkMode;
  payloadBytes: number;
  pollIntervalMs: number;
  sqlitePath: string;
  steadyDurationMs: number;
  steadyRatePerSecond: number;
  storage: StorageEngine;
  warmup: number;
  workerConcurrency: number;
}

interface QueueJobPayload {
  operationId: string;
  payload: string;
  runId: string;
}

interface BenchmarkReport {
  details?: Record<string, boolean | number | string>;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  measurementWindowMs: number;
  recommendedPerSecond: number;
  throughputPerSecond: number;
  totalDurationMs: number;
  totalOperations: number;
}

const insertActionRecord = action({
  args: v.object({
    operationId: v.string(),
    payload: v.string(),
    runId: v.string(),
  }),
  async handler(ctx, input) {
    await ctx.db.query(
      `
        INSERT INTO load_test_actions (
          operation_id,
          run_id,
          payload,
          created_at_ms
        ) VALUES (?1, ?2, ?3, ?4)
      `,
      [input.operationId, input.runId, input.payload, performance.now()],
    );

    return null;
  },
  name: "insertActionRecord",
});

const resetLoadTestData = action({
  async handler(ctx) {
    await ctx.db.query("DELETE FROM load_test_actions");
    await ctx.db.query("DELETE FROM load_test_queue_jobs");
    return null;
  },
  name: "resetLoadTestData",
});

const enqueueQueueJob = action({
  args: v.object({
    operationId: v.string(),
    payload: v.string(),
    runId: v.string(),
  }),
  async handler(ctx, input) {
    await ctx.db.query(
      `
        INSERT INTO load_test_queue_jobs (
          operation_id,
          run_id,
          payload,
          enqueued_at_ms,
          processed_at_ms
        ) VALUES (?1, ?2, ?3, ?4, NULL)
      `,
      [input.operationId, input.runId, input.payload, performance.now()],
    );
    await ctx.queue.enqueue("load-test.process", {
      operationId: input.operationId,
      payload: input.payload,
      runId: input.runId,
    } satisfies QueueJobPayload);

    return null;
  },
  name: "enqueueQueueJob",
});

const seedQueueRun = action({
  args: v.object({
    count: v.number(),
    payload: v.string(),
    runId: v.string(),
  }),
  async handler(_ctx, input) {
    for (let index = 0; index < input.count; index += 1) {
      await enqueueQueueJob({
        operationId: createOperationId(input.runId, index),
        payload: `${input.payload}:${index}`,
        runId: input.runId,
      });
    }

    return { enqueued: input.count };
  },
  name: "seedQueueRun",
});

const countProcessedQueueJobs = action({
  args: v.object({
    runId: v.string(),
  }),
  async handler(ctx, input) {
    const [row] = await ctx.db.query<{ processed_count: number | string }>(
      `
        SELECT COUNT(*) AS processed_count
        FROM load_test_queue_jobs
        WHERE run_id = ?1
          AND processed_at_ms IS NOT NULL
      `,
      [input.runId],
    );

    return Number(row?.processed_count ?? 0);
  },
  name: "countProcessedQueueJobs",
});

const listQueueLatencies = action({
  args: v.object({
    runId: v.string(),
  }),
  async handler(ctx, input) {
    const rows = await ctx.db.query<{ latency_ms: number | string }>(
      `
        SELECT processed_at_ms - enqueued_at_ms AS latency_ms
        FROM load_test_queue_jobs
        WHERE run_id = ?1
          AND processed_at_ms IS NOT NULL
        ORDER BY operation_id ASC
      `,
      [input.runId],
    );

    return rows.map((row) => Number(row.latency_ms));
  },
  name: "listQueueLatencies",
});

const processQueueJob: ChimpbaseWorkerHandler<QueueJobPayload, void> = async (ctx, payload) => {
  await ctx.db.query(
    `
      UPDATE load_test_queue_jobs
      SET processed_at_ms = ?1
      WHERE operation_id = ?2
    `,
    [performance.now(), payload.operationId],
  );
};

export const loadTestApp = {
  migrations: {
    postgres: [
      {
        name: "001_load_test_tables",
        sql: `
          CREATE TABLE IF NOT EXISTS load_test_actions (
            operation_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at_ms DOUBLE PRECISION NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_load_test_actions_run_id
          ON load_test_actions(run_id);

          CREATE TABLE IF NOT EXISTS load_test_queue_jobs (
            operation_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            enqueued_at_ms DOUBLE PRECISION NOT NULL,
            processed_at_ms DOUBLE PRECISION
          );

          CREATE INDEX IF NOT EXISTS idx_load_test_queue_jobs_run_id
          ON load_test_queue_jobs(run_id);
        `,
      },
    ],
    sqlite: [
      {
        name: "001_load_test_tables",
        sql: `
          CREATE TABLE IF NOT EXISTS load_test_actions (
            operation_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at_ms REAL NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_load_test_actions_run_id
          ON load_test_actions(run_id);

          CREATE TABLE IF NOT EXISTS load_test_queue_jobs (
            operation_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            enqueued_at_ms REAL NOT NULL,
            processed_at_ms REAL
          );

          CREATE INDEX IF NOT EXISTS idx_load_test_queue_jobs_run_id
          ON load_test_queue_jobs(run_id);
        `,
      },
    ],
  },
  project: {
    name: "load-test",
  },
  registrations: [
    insertActionRecord,
    resetLoadTestData,
    enqueueQueueJob,
    seedQueueRun,
    countProcessedQueueJobs,
    listQueueLatencies,
    worker("load-test.process", processQueueJob),
  ],
  worker: {
    retryDelayMs: 0,
  },
} satisfies ChimpbaseAppDefinitionInput;

async function createLoadTestHost(options: LoadTestOptions) {
  const sqlitePath = resolve(import.meta.dir, options.sqlitePath);
  if (options.storage === "sqlite") {
    await mkdir(dirname(sqlitePath), { recursive: true });
  }

  return await createChimpbase({
    app: loadTestApp,
    debug: options.debug,
    projectDir: import.meta.dir,
    storage: options.storage === "memory"
      ? { engine: "memory" }
      : options.storage === "postgres"
        ? { engine: "postgres", url: requireDatabaseUrl(options) }
        : { engine: "sqlite", path: sqlitePath },
    workerRuntime: {
      concurrency: options.workerConcurrency,
      pollIntervalMs: options.pollIntervalMs,
    },
  });
}

export async function createLoadTestBenchmarkHost(options: LoadTestOptions) {
  return await createLoadTestHost(options);
}

export async function runActionBenchmark(options: LoadTestOptions): Promise<BenchmarkReport> {
  const host = await createLoadTestHost(options);
  const payload = createPayload(options.payloadBytes);

  try {
    await host.executeAction(resetLoadTestData);
    if (options.warmup > 0) {
      await runConcurrentOperations(options.warmup, options.concurrency, async (index) => {
        await host.executeAction(insertActionRecord, {
          operationId: `warmup:${index}`,
          payload,
          runId: "warmup",
        });
      });
    }

    await host.executeAction(resetLoadTestData);

    const runId = `action:${crypto.randomUUID()}`;
    const startedAtMs = performance.now();
    const latenciesMs = await runConcurrentOperations(options.iterations, options.concurrency, async (index) => {
      await host.executeAction(insertActionRecord, {
        operationId: `${runId}:${index}`,
        payload,
        runId,
      });
    });
    const finishedAtMs = performance.now();

    return buildReport(latenciesMs, options.headroom, finishedAtMs - startedAtMs);
  } finally {
    host.close();
  }
}

export async function runQueueBurstBenchmark(options: LoadTestOptions): Promise<BenchmarkReport> {
  const host = await createLoadTestHost(options);
  const payload = createPayload(options.payloadBytes);

  try {
    await host.executeAction(resetLoadTestData);

    if (options.warmup > 0) {
      const warmupRunId = `queue:warmup:${crypto.randomUUID()}`;
      await host.executeAction(seedQueueRun, {
        count: options.warmup,
        payload,
        runId: warmupRunId,
      });
      await drainQueueRun(host, warmupRunId, options.warmup);
      await host.executeAction(resetLoadTestData);
    }

    const runId = `queue:${crypto.randomUUID()}`;
    await host.executeAction(seedQueueRun, {
      count: options.iterations,
      payload,
      runId,
    });

    const started = await host.start({ runWorker: true, serve: false });
    const startedAtMs = performance.now();

    try {
      const latenciesMs = await waitForQueueLatencies(host, runId, options.iterations);
      const finishedAtMs = performance.now();

      return buildReport(latenciesMs, options.headroom, finishedAtMs - startedAtMs, {
        benchmark: "queue-burst",
      });
    } finally {
      await started.stop();
    }
  } finally {
    host.close();
  }
}

export async function runQueueSteadyBenchmark(options: LoadTestOptions): Promise<BenchmarkReport> {
  const host = await createLoadTestHost(options);
  const payload = createPayload(options.payloadBytes);

  try {
    await host.executeAction(resetLoadTestData);

    if (options.warmup > 0) {
      const warmupRunId = `queue-steady:warmup:${crypto.randomUUID()}`;
      await host.executeAction(seedQueueRun, {
        count: options.warmup,
        payload,
        runId: warmupRunId,
      });
      await drainQueueRun(host, warmupRunId, options.warmup);
      await host.executeAction(resetLoadTestData);
    }

    const runId = `queue-steady:${crypto.randomUUID()}`;
    const started = await host.start({ runWorker: true, serve: false });
    const targetIntervalMs = 1_000 / options.steadyRatePerSecond;
    let produced = 0;
    let nextDueAtMs = performance.now();
    const windowStartedAtMs = performance.now();

    try {
      while (performance.now() - windowStartedAtMs < options.steadyDurationMs) {
        await host.executeAction(enqueueQueueJob, {
          operationId: createOperationId(runId, produced),
          payload: `${payload}:${produced}`,
          runId,
        });
        produced += 1;
        nextDueAtMs += targetIntervalMs;

        const sleepMs = nextDueAtMs - performance.now();
        if (sleepMs > 0) {
          await Bun.sleep(sleepMs);
        }
      }

      const windowFinishedAtMs = performance.now();
      const processedByWindow = await host.executeAction(countProcessedQueueJobs, { runId });
      const backlogAtWindowEnd = Math.max(0, produced - processedByWindow.result);
      const latenciesMs = await waitForQueueLatencies(host, runId, produced);
      const fullyDrainedAtMs = performance.now();
      const measurementWindowMs = windowFinishedAtMs - windowStartedAtMs;
      const processedPerSecond = measurementWindowMs === 0
        ? 0
        : (processedByWindow.result / measurementWindowMs) * 1_000;
      const actualIngressPerSecond = measurementWindowMs === 0
        ? 0
        : (produced / measurementWindowMs) * 1_000;

      return buildReport(
        latenciesMs,
        options.headroom,
        measurementWindowMs,
        {
          actualIngressPerSecond: formatNumber(actualIngressPerSecond),
          backlogAtWindowEnd,
          benchmark: "queue-steady",
          catchUpDurationMs: formatNumber(fullyDrainedAtMs - windowFinishedAtMs),
          keptUp: backlogAtWindowEnd === 0,
          processedDuringWindow: processedByWindow.result,
          targetIngressPerSecond: options.steadyRatePerSecond,
        },
        processedPerSecond,
        fullyDrainedAtMs - windowStartedAtMs,
      );
    } finally {
      await started.stop();
    }
  } finally {
    host.close();
  }
}

async function drainQueueRun(
  host: Awaited<ReturnType<typeof createLoadTestHost>>,
  runId: string,
  expectedCount: number,
): Promise<void> {
  const started = await host.start({ runWorker: true, serve: false });

  try {
    await waitForQueueLatencies(host, runId, expectedCount);
  } finally {
    await started.stop();
  }
}

async function waitForQueueLatencies(
  host: Awaited<ReturnType<typeof createLoadTestHost>>,
  runId: string,
  expectedCount: number,
): Promise<number[]> {
  while (true) {
    const processed = await host.executeAction(countProcessedQueueJobs, { runId });
    if (processed.result >= expectedCount) {
      const latencies = await host.executeAction(listQueueLatencies, { runId });
      return latencies.result;
    }

    await Bun.sleep(10);
  }
}

async function runConcurrentOperations(
  total: number,
  concurrency: number,
  operation: (index: number) => Promise<void>,
): Promise<number[]> {
  const latenciesMs: number[] = [];
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= total) {
        return;
      }

      const startedAtMs = performance.now();
      await operation(current);
      latenciesMs.push(performance.now() - startedAtMs);
    }
  });

  await Promise.all(workers);
  return latenciesMs;
}

function buildReport(
  latenciesMs: number[],
  headroom: number,
  measurementWindowMs: number,
  details?: Record<string, boolean | number | string>,
  throughputOverridePerSecond?: number,
  totalDurationOverrideMs?: number,
): BenchmarkReport {
  const sorted = [...latenciesMs].sort((left, right) => left - right);
  const throughputPerSecond = throughputOverridePerSecond
    ?? (measurementWindowMs === 0 ? 0 : (sorted.length / measurementWindowMs) * 1_000);
  const totalDurationMs = totalDurationOverrideMs ?? measurementWindowMs;

  return {
    details,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    measurementWindowMs,
    recommendedPerSecond: Math.max(1, Math.floor(throughputPerSecond * headroom)),
    throughputPerSecond,
    totalDurationMs,
    totalOperations: sorted.length,
  };
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1));
  return sortedValues[index] ?? 0;
}

function createPayload(bytes: number): string {
  const size = Math.max(16, bytes);
  return "x".repeat(size);
}

function createOperationId(runId: string, index: number): string {
  return `${runId}:${index.toString().padStart(8, "0")}`;
}

export function parseArgs(argv: string[]): LoadTestOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, "true");
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  const mode = normalizeMode(values.get("mode"));
  const storage = values.get("storage") as StorageEngine | undefined;

  return {
    concurrency: parseInteger(values.get("concurrency"), 16),
    databaseUrl: values.get("database-url")
      ?? process.env.CHIMPBASE_DATABASE_URL
      ?? process.env.DATABASE_URL
      ?? null,
    debug: parseBoolean(values.get("debug"), false),
    headroom: parseFloatValue(values.get("headroom"), 0.7),
    iterations: parseInteger(values.get("iterations"), 2_000),
    mode,
    payloadBytes: parseInteger(values.get("payload-bytes"), 512),
    pollIntervalMs: parseInteger(values.get("poll-interval-ms"), 1),
    sqlitePath: values.get("sqlite-path") ?? "data/load-test.db",
    steadyDurationMs: parseInteger(values.get("steady-duration-ms"), 10_000),
    steadyRatePerSecond: parseInteger(values.get("steady-rate"), 50),
    storage: storage === "memory" || storage === "postgres" || storage === "sqlite" ? storage : "sqlite",
    warmup: parseInteger(values.get("warmup"), 200),
    workerConcurrency: parseInteger(values.get("worker-concurrency"), 1),
  };
}

function normalizeMode(value: string | undefined): BenchmarkMode {
  if (value === "action" || value === "queue-burst" || value === "queue-steady" || value === "both") {
    return value;
  }

  if (value === "queue") {
    return "queue-burst";
  }

  if (value === "all") {
    return "both";
  }

  return "both";
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatValue(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }

  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }

  return fallback;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function requireDatabaseUrl(options: Pick<LoadTestOptions, "databaseUrl" | "storage">): string {
  if (options.storage !== "postgres") {
    throw new Error(`database url requested for unsupported storage ${options.storage}`);
  }

  if (!options.databaseUrl) {
    throw new Error("postgres load test requires --database-url or DATABASE_URL");
  }

  return options.databaseUrl;
}

function printHeader(options: LoadTestOptions): void {
  console.log("Chimpbase Single-Process Load Test");
  console.log(`mode=${options.mode} storage=${options.storage} iterations=${options.iterations} warmup=${options.warmup} concurrency=${options.concurrency} payloadBytes=${options.payloadBytes}`);
  console.log(`pollIntervalMs=${options.pollIntervalMs} workerConcurrency=${options.workerConcurrency} headroom=${formatNumber(options.headroom)} steadyRate=${options.steadyRatePerSecond} steadyDurationMs=${options.steadyDurationMs}`);
  console.log("");
}

function printReport(name: string, report: BenchmarkReport): void {
  console.log(`${name}`);
  console.log(`  totalOperations=${report.totalOperations}`);
  console.log(`  measurementWindowMs=${formatNumber(report.measurementWindowMs)}`);
  console.log(`  totalDurationMs=${formatNumber(report.totalDurationMs)}`);
  console.log(`  throughputPerSecond=${formatNumber(report.throughputPerSecond)}`);
  console.log(`  p50Ms=${formatNumber(report.p50Ms)} p95Ms=${formatNumber(report.p95Ms)} p99Ms=${formatNumber(report.p99Ms)}`);
  console.log(`  recommendedPerSecond=${report.recommendedPerSecond}`);
  if (report.details) {
    for (const [key, value] of Object.entries(report.details)) {
      console.log(`  ${key}=${value}`);
    }
  }
  console.log("");
}

export async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  printHeader(options);

  if (options.mode === "action" || options.mode === "both") {
    const actionReport = await runActionBenchmark(options);
    printReport("action", actionReport);
  }

  if (options.mode === "queue-burst" || options.mode === "both") {
    const queueBurstReport = await runQueueBurstBenchmark(options);
    printReport("queue-burst", queueBurstReport);
  }

  if (options.mode === "queue-steady" || options.mode === "both") {
    const queueSteadyReport = await runQueueSteadyBenchmark(options);
    printReport("queue-steady", queueSteadyReport);
  }
}

if (import.meta.main) {
  await main();
}
