import type {
  ChimpbaseCollectionFilter,
  ChimpbaseCollectionFindOptions,
  ChimpbaseCollectionPatch,
  ChimpbaseContext,
  ChimpbaseDlqEnvelope,
  ChimpbaseKvListOptions,
  ChimpbaseLogger,
  ChimpbaseQueueSendOptions,
  ChimpbaseRouteEnv,
  ChimpbaseStreamEvent,
  ChimpbaseStreamReadOptions,
  ChimpbaseTelemetryAttributes,
  ChimpbaseTraceSpan,
} from "@chimpbase/runtime";

import type { ChimpbaseRegistry } from "./index.ts";

export interface ChimpbaseExecutionScope {
  kind: "action" | "listener" | "queue";
  name: string;
}

export interface ChimpbaseEventRecord {
  name: string;
  payload: unknown;
  payloadJson: string;
}

export interface ChimpbaseQueueJobRecord {
  attempt_count: number;
  id: number;
  payload_json: string;
  queue_name: string;
}

export type ChimpbaseTelemetryRecord =
  | {
      attributes: ChimpbaseTelemetryAttributes;
      kind: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      scope: ChimpbaseExecutionScope;
      timestamp: string;
    }
  | {
      kind: "metric";
      labels: ChimpbaseTelemetryAttributes;
      name: string;
      scope: ChimpbaseExecutionScope;
      timestamp: string;
      value: number;
    }
  | {
      attributes: ChimpbaseTelemetryAttributes;
      kind: "trace";
      name: string;
      phase: "start" | "end";
      scope: ChimpbaseExecutionScope;
      status?: "error" | "ok";
      timestamp: string;
    };

export interface ChimpbaseActionExecutionResult {
  emittedEvents: ChimpbaseEventRecord[];
  result: unknown;
}

export interface ChimpbaseQueueExecutionResult {
  emittedEvents: ChimpbaseEventRecord[];
  jobId: number;
  queueName: string;
}

export interface ChimpbaseRouteExecutionResult {
  emittedEvents: ChimpbaseEventRecord[];
  response: Response | null;
}

export interface ChimpbaseEngineAdapter {
  beginTransaction(): Promise<void>;
  claimNextQueueJob(leaseMs: number): Promise<ChimpbaseQueueJobRecord | null>;
  collectionDelete(name: string, filter?: ChimpbaseCollectionFilter): Promise<number>;
  collectionFind<TDocument = Record<string, unknown>>(
    name: string,
    filter?: ChimpbaseCollectionFilter,
    options?: ChimpbaseCollectionFindOptions,
  ): Promise<TDocument[]>;
  collectionFindOne<TDocument = Record<string, unknown>>(
    name: string,
    filter: ChimpbaseCollectionFilter,
  ): Promise<TDocument | null>;
  collectionInsert<TDocument extends Record<string, unknown>>(
    name: string,
    document: TDocument,
  ): Promise<string>;
  collectionList(): Promise<string[]>;
  collectionUpdate(
    name: string,
    filter: ChimpbaseCollectionFilter,
    patch: ChimpbaseCollectionPatch,
  ): Promise<number>;
  commitTransaction(events: ChimpbaseEventRecord[]): Promise<void>;
  completeQueueJob(jobId: number): Promise<void>;
  getQueueJobPayload(jobId: number): Promise<string | null>;
  kvDelete(key: string): Promise<void>;
  kvGet<TValue = unknown>(key: string): Promise<TValue | null>;
  kvList(options?: ChimpbaseKvListOptions): Promise<string[]>;
  kvSet<TValue = unknown>(key: string, value: TValue): Promise<void>;
  markQueueJobFailure(
    jobId: number,
    status: "dlq" | "failed" | "pending",
    nextAvailableAtMs: number,
    errorMessage: string,
  ): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  queueSend<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: ChimpbaseQueueSendOptions,
  ): Promise<void>;
  rollbackTransaction(): Promise<void>;
  secret(name: string): string | null;
  streamPublish<TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number>;
  streamRead<TPayload = unknown>(
    stream: string,
    options?: ChimpbaseStreamReadOptions,
  ): Promise<ChimpbaseStreamEvent<TPayload>[]>;
}

export interface ChimpbaseEngineOptions {
  adapter: ChimpbaseEngineAdapter;
  registry: ChimpbaseRegistry;
  worker: {
    leaseMs: number;
    maxAttempts: number;
    retryDelayMs: number;
  };
}

export class ChimpbaseEngine {
  private readonly adapter: ChimpbaseEngineAdapter;
  private readonly committedEvents: ChimpbaseEventRecord[] = [];
  private readonly pendingEvents: ChimpbaseEventRecord[] = [];
  private readonly registry: ChimpbaseRegistry;
  private readonly telemetryRecords: ChimpbaseTelemetryRecord[] = [];
  private transactionDepth = 0;
  private readonly worker: ChimpbaseEngineOptions["worker"];

  constructor(options: ChimpbaseEngineOptions) {
    this.adapter = options.adapter;
    this.registry = options.registry;
    this.worker = options.worker;
  }

  async executeAction(name: string, args: unknown[] = []): Promise<ChimpbaseActionExecutionResult> {
    const result = await this.invokeActionByName(name, args);
    const emittedEvents = this.takeCommittedEvents();
    await this.dispatchListeners(emittedEvents);
    const allEmittedEvents = this.takeCommittedEvents();

    return {
      emittedEvents: [...emittedEvents, ...allEmittedEvents],
      result,
    };
  }

  async executeRoute(request: Request): Promise<ChimpbaseRouteExecutionResult> {
    const routeEnv = this.createRouteEnv();
    const response = this.registry.httpHandler
      ? await this.registry.httpHandler(request, routeEnv)
      : null;

    const emittedEvents = this.takeCommittedEvents();
    await this.dispatchListeners(emittedEvents);
    const allEmittedEvents = this.takeCommittedEvents();

    return {
      emittedEvents: [...emittedEvents, ...allEmittedEvents],
      response,
    };
  }

  async processNextQueueJob(): Promise<ChimpbaseQueueExecutionResult | null> {
    const job = await this.adapter.claimNextQueueJob(this.worker.leaseMs);
    if (!job) {
      return null;
    }

    const queue = this.registry.queues.get(job.queue_name);
    if (!queue) {
      await this.failQueueJob(job.id, job.queue_name, `queue handler not found: ${job.queue_name}`, job.attempt_count);
      throw new Error(`queue handler not found: ${job.queue_name}`);
    }

    try {
      const payload = JSON.parse(job.payload_json) as unknown;
      await this.runInTransaction(async () => {
        await queue.handler(this.createContext({ kind: "queue", name: job.queue_name }), payload);
      });

      const emittedEvents = this.takeCommittedEvents();
      await this.dispatchListeners(emittedEvents);
      const allEmittedEvents = this.takeCommittedEvents();
      const combinedEvents = [...emittedEvents, ...allEmittedEvents];

      await this.adapter.completeQueueJob(job.id);

      return {
        emittedEvents: combinedEvents,
        jobId: job.id,
        queueName: job.queue_name,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failQueueJob(job.id, job.queue_name, message, job.attempt_count);
      throw error;
    }
  }

  drainTelemetryRecords(): ChimpbaseTelemetryRecord[] {
    return this.telemetryRecords.splice(0);
  }

  createRouteEnv(): ChimpbaseRouteEnv {
    return {
      action: async <TArgs extends unknown[] = unknown[], TResult = unknown>(
        name: string,
        ...args: TArgs
      ): Promise<TResult> => await this.invokeActionByName<TResult>(name, args),
    };
  }

  private createContext(scope: ChimpbaseExecutionScope): ChimpbaseContext {
    return {
      query: <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) =>
        this.adapter.query<T>(sql, params),
      emit: (eventName: string, payload: unknown) => {
        const event = {
          name: eventName,
          payload,
          payloadJson: JSON.stringify(payload ?? null),
        };

        if (this.transactionDepth > 0) {
          this.pendingEvents.push(event);
        } else {
          this.committedEvents.push(event);
        }
      },
      secret: (name: string) => this.adapter.secret(name),
      kv: {
        delete: async (key: string) => await this.adapter.kvDelete(key),
        get: async <TValue = unknown>(key: string): Promise<TValue | null> => await this.adapter.kvGet<TValue>(key),
        list: async (options?: ChimpbaseKvListOptions): Promise<string[]> => await this.adapter.kvList(options),
        set: async <TValue = unknown>(key: string, value: TValue) => await this.adapter.kvSet(key, value),
      },
      collection: {
        delete: async (name: string, filter: ChimpbaseCollectionFilter = {}): Promise<number> =>
          await this.adapter.collectionDelete(name, filter),
        find: async <TDocument = Record<string, unknown>>(
          name: string,
          filter: ChimpbaseCollectionFilter = {},
          options?: ChimpbaseCollectionFindOptions,
        ): Promise<TDocument[]> => await this.adapter.collectionFind<TDocument>(name, filter, options),
        findOne: async <TDocument = Record<string, unknown>>(
          name: string,
          filter: ChimpbaseCollectionFilter,
        ): Promise<TDocument | null> => await this.adapter.collectionFindOne<TDocument>(name, filter),
        insert: async <TDocument extends Record<string, unknown>>(name: string, document: TDocument): Promise<string> =>
          await this.adapter.collectionInsert(name, document),
        list: async (): Promise<string[]> => await this.adapter.collectionList(),
        update: async (name: string, filter: ChimpbaseCollectionFilter, patch: ChimpbaseCollectionPatch): Promise<number> =>
          await this.adapter.collectionUpdate(name, filter, patch),
      },
      stream: {
        publish: async <TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number> =>
          await this.adapter.streamPublish(stream, event, payload),
        read: async <TPayload = unknown>(
          stream: string,
          options?: ChimpbaseStreamReadOptions,
        ): Promise<ChimpbaseStreamEvent<TPayload>[]> => await this.adapter.streamRead<TPayload>(stream, options),
      },
      queue: {
        send: async <TPayload = unknown>(
          name: string,
          payload: TPayload,
          options?: ChimpbaseQueueSendOptions,
        ) => await this.adapter.queueSend(name, payload, options),
      },
      log: createLogger((level, message, attributes) => {
        this.recordLog(scope, level, message, attributes);
      }),
      metric: (name, value, labels = {}) => {
        this.telemetryRecords.push({
          kind: "metric",
          labels,
          name,
          scope,
          timestamp: new Date().toISOString(),
          value,
        });
      },
      trace: async <TResult>(
        name: string,
        callback: (span: ChimpbaseTraceSpan) => TResult | Promise<TResult>,
        attributes: ChimpbaseTelemetryAttributes = {},
      ): Promise<TResult> => {
        const spanAttributes: ChimpbaseTelemetryAttributes = { ...attributes };
        const span: ChimpbaseTraceSpan = {
          setAttribute(key, value) {
            spanAttributes[key] = value;
          },
        };

        this.telemetryRecords.push({
          attributes: { ...spanAttributes },
          kind: "trace",
          name,
          phase: "start",
          scope,
          timestamp: new Date().toISOString(),
        });

        try {
          const result = await callback(span);
          this.telemetryRecords.push({
            attributes: { ...spanAttributes },
            kind: "trace",
            name,
            phase: "end",
            scope,
            status: "ok",
            timestamp: new Date().toISOString(),
          });
          return result;
        } catch (error) {
          this.telemetryRecords.push({
            attributes: {
              ...spanAttributes,
              error: error instanceof Error ? error.message : String(error),
            },
            kind: "trace",
            name,
            phase: "end",
            scope,
            status: "error",
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },
      action: async <TArgs extends unknown[] = unknown[], TResult = unknown>(
        name: string,
        ...args: TArgs
      ): Promise<TResult> => await this.invokeActionByName<TResult>(name, args),
    };
  }

  private async invokeActionByName<TResult = unknown>(
    name: string,
    args: unknown[],
  ): Promise<TResult> {
    const handler = this.registry.actions.get(name);
    if (!handler) {
      throw new Error(`action not found: ${name}`);
    }

    return await this.runInTransaction(async () => {
      return await handler(this.createContext({ kind: "action", name }), ...args) as TResult;
    });
  }

  private async dispatchListeners(events: ChimpbaseEventRecord[]): Promise<void> {
    for (const event of events) {
      const listeners = this.registry.listeners.get(event.name) ?? [];
      for (const listener of listeners) {
        await this.runInTransaction(async () => {
          await listener(this.createContext({ kind: "listener", name: event.name }), event.payload);
        });
      }
    }
  }

  private async runInTransaction<T>(callback: () => Promise<T>): Promise<T> {
    const isRootTransaction = this.transactionDepth === 0;

    if (isRootTransaction) {
      await this.adapter.beginTransaction();
    }

    this.transactionDepth += 1;

    try {
      const result = await callback();
      this.transactionDepth -= 1;

      if (isRootTransaction) {
        await this.adapter.commitTransaction(this.pendingEvents);
        this.committedEvents.push(...this.pendingEvents.splice(0));
      }

      return result;
    } catch (error) {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);

      if (isRootTransaction) {
        this.pendingEvents.splice(0);
        await this.adapter.rollbackTransaction();
      }

      throw error;
    }
  }

  private async failQueueJob(
    jobId: number,
    queueName: string,
    errorMessage: string,
    attempts: number,
  ): Promise<void> {
    const queue = this.registry.queues.get(queueName);
    const dlqName = queue?.definition.dlq;
    const shouldDlq = typeof dlqName === "string" && attempts >= this.worker.maxAttempts;

    if (shouldDlq && queue) {
      const payloadJson = await this.adapter.getQueueJobPayload(jobId);
      if (payloadJson) {
        const envelope: ChimpbaseDlqEnvelope = {
          attempts,
          error: errorMessage,
          failedAt: new Date().toISOString(),
          payload: JSON.parse(payloadJson) as unknown,
          queue: queueName,
        };
        await this.adapter.queueSend(dlqName, envelope);
      }
    }

    const nextStatus = shouldDlq ? "dlq" : (attempts >= this.worker.maxAttempts ? "failed" : "pending");
    const nextAvailableAtMs = Date.now() + this.worker.retryDelayMs;
    await this.adapter.markQueueJobFailure(jobId, nextStatus, nextAvailableAtMs, errorMessage);
  }

  private recordLog(
    scope: ChimpbaseExecutionScope,
    level: "debug" | "info" | "warn" | "error",
    message: string,
    attributes: ChimpbaseTelemetryAttributes = {},
  ): void {
    this.telemetryRecords.push({
      attributes,
      kind: "log",
      level,
      message,
      scope,
      timestamp: new Date().toISOString(),
    });
  }

  private takeCommittedEvents(): ChimpbaseEventRecord[] {
    return this.committedEvents.splice(0);
  }
}

function createLogger(
  record: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    attributes?: ChimpbaseTelemetryAttributes,
  ) => void,
): ChimpbaseLogger {
  return {
    debug(message, attributes) {
      record("debug", message, attributes);
    },
    info(message, attributes) {
      record("info", message, attributes);
    },
    warn(message, attributes) {
      record("warn", message, attributes);
    },
    error(message, attributes) {
      record("error", message, attributes);
    },
  };
}
