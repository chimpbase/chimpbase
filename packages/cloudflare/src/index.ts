// Cloudflare Durable Object storage adapter (T2 of the Chimpbase Edge plan).
//
// Scope: SQLite storage on `ctx.storage.sql` plus the engine transaction hook.
// TODO(T3): alarm-based scheduler (wake the Durable Object for queue jobs, cron, and
//   workflow timers through `ctx.storage.setAlarm`). Until then, drive
//   `engine.processNextQueueJob()` / `engine.processNextCronSchedule()` yourself.
// TODO(T4): R2 blob driver. Until then, do not configure `blobs` on a Durable Object engine.
export {
  createDurableObjectEngineAdapter,
  createDurableObjectSqliteDatabase,
  prepareDurableObjectSqlite,
  type DurableObjectSqlCursorLike,
  type DurableObjectSqliteDatabase,
  type DurableObjectSqliteStorageLike,
  type DurableObjectSqlStorageLike,
  type DurableObjectSqlValue,
  type PrepareDurableObjectSqliteOptions,
} from "./durable_object_sqlite.ts";
