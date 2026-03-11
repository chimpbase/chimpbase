import type { Kysely } from "kysely";

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
  ChimpbaseWorkflowDefinition,
  ChimpbaseWorkflowRunContext,
  ChimpbaseWorkflowRunResult,
  ChimpbaseWorkflowRuntimeState,
  ChimpbaseWorkflowWaitForSignalDirective,
  ChimpbaseWorkflowInstance,
  ChimpbaseWorkflowRegistration,
  ChimpbaseWorkflowStartOptions,
  ChimpbaseWorkflowStartResult,
  ChimpbaseWorkflowStepsDraftDefinition,
  ChimpbaseWorkflowStepDefinition,
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

type ChimpbaseWorkflowStatus =
  | "completed"
  | "failed"
  | "running"
  | "sleeping"
  | "waiting_signal";

interface PersistedWorkflowInstanceRow {
  current_step_id: string | null;
  current_step_index: number;
  input_json: string;
  last_error: string | null;
  status: ChimpbaseWorkflowStatus;
  state_json: string;
  wake_at_ms: number | null;
  workflow_id: string;
  workflow_name: string;
  workflow_version: number;
}

interface PersistedWorkflowSignalRow {
  id: number;
  payload_json: string;
}

interface WorkflowQueuePayload {
  workflowId: string;
}

type WorkflowRunDirective = ChimpbaseWorkflowRunResult<any, any>;

const INTERNAL_WORKFLOW_QUEUE_NAME = "__chimpbase.workflow.run";

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
  createKysely<TDatabase = Record<string, never>>(): Kysely<TDatabase>;
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  queueSend<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: ChimpbaseQueueSendOptions,
  ): Promise<void>;
  rollbackTransaction(): Promise<void>;
  streamPublish<TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number>;
  streamRead<TPayload = unknown>(
    stream: string,
    options?: ChimpbaseStreamReadOptions,
  ): Promise<ChimpbaseStreamEvent<TPayload>[]>;
}

export interface ChimpbaseEngineOptions {
  adapter: ChimpbaseEngineAdapter;
  registry: ChimpbaseRegistry;
  secrets: {
    get(name: string): string | null;
  };
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
  private readonly secrets: ChimpbaseEngineOptions["secrets"];
  private readonly telemetryRecords: ChimpbaseTelemetryRecord[] = [];
  private transactionDepth = 0;
  private readonly worker: ChimpbaseEngineOptions["worker"];

  constructor(options: ChimpbaseEngineOptions) {
    this.adapter = options.adapter;
    this.registry = options.registry;
    this.secrets = options.secrets;
    this.worker = options.worker;

    if (this.registry.queues.has(INTERNAL_WORKFLOW_QUEUE_NAME)) {
      throw new Error(`reserved queue name already registered: ${INTERNAL_WORKFLOW_QUEUE_NAME}`);
    }

    this.registry.queues.set(INTERNAL_WORKFLOW_QUEUE_NAME, {
      definition: { dlq: false },
      handler: async (_ctx, payload) => {
        const message = payload as WorkflowQueuePayload;
        await this.processWorkflowQueuePayload(message);
      },
      name: INTERNAL_WORKFLOW_QUEUE_NAME,
    });
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
      db: <TDatabase = Record<string, never>>() =>
        this.adapter.createKysely<TDatabase>(),
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
      secret: (name: string) => this.secrets.get(name),
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
      workflow: {
        get: async <TInput = unknown, TState = unknown>(
          workflowId: string,
        ): Promise<ChimpbaseWorkflowInstance<TInput, TState> | null> =>
          await this.getWorkflowInstance<TInput, TState>(workflowId),
        signal: async <TPayload = unknown>(
          workflowId: string,
          signalName: string,
          payload: TPayload,
        ): Promise<void> => {
          await this.signalWorkflow(workflowId, signalName, payload);
        },
        start: async <TInput = unknown, TState = unknown>(
          definition:
            | string
            | ChimpbaseWorkflowDefinition<TInput, TState>
            | ChimpbaseWorkflowRegistration<TInput, TState>,
          input: TInput,
          options?: ChimpbaseWorkflowStartOptions,
        ): Promise<ChimpbaseWorkflowStartResult> =>
          await this.startWorkflow(definition, input, options),
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

  private async startWorkflow<TInput = unknown, TState = unknown>(
    definitionReference:
      | string
      | ChimpbaseWorkflowDefinition<TInput, TState>
      | ChimpbaseWorkflowRegistration<TInput, TState>,
    input: TInput,
    options?: ChimpbaseWorkflowStartOptions,
  ): Promise<ChimpbaseWorkflowStartResult> {
    const definition = this.resolveWorkflowDefinition(definitionReference);
    const workflowId = options?.workflowId ?? crypto.randomUUID();

    await this.adapter.query(
      `
        INSERT INTO _chimpbase_workflow_instances (
          workflow_id,
          workflow_name,
          workflow_version,
          status,
          input_json,
          state_json,
          current_step_id,
          current_step_index,
          wake_at_ms,
          last_error,
          lease_token,
          lease_expires_at_ms
        ) VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, 0, NULL, NULL, NULL, NULL)
      `,
      [
        workflowId,
        definition.name,
        definition.version,
        JSON.stringify(input ?? null),
        JSON.stringify(definition.initialState(input) ?? null),
        hasWorkflowSteps(definition) ? definition.steps[0]?.id ?? null : null,
      ],
    );

    await this.adapter.queueSend(INTERNAL_WORKFLOW_QUEUE_NAME, { workflowId } satisfies WorkflowQueuePayload);

    return {
      status: "running",
      workflowId,
      workflowName: definition.name,
      workflowVersion: definition.version,
    };
  }

  private async signalWorkflow<TPayload = unknown>(
    workflowId: string,
    signalName: string,
    payload: TPayload,
  ): Promise<void> {
    const instance = await this.loadWorkflowInstanceRow(workflowId);
    if (!instance) {
      throw new Error(`workflow not found: ${workflowId}`);
    }

    if (instance.status === "completed" || instance.status === "failed") {
      throw new Error(`workflow is terminal: ${workflowId}`);
    }

    await this.adapter.query(
      `
        INSERT INTO _chimpbase_workflow_signals (
          workflow_id,
          signal_name,
          payload_json,
          consumed_at
        ) VALUES (?1, ?2, ?3, NULL)
      `,
      [
        workflowId,
        signalName,
        JSON.stringify(payload ?? null),
      ],
    );

    await this.adapter.queueSend(INTERNAL_WORKFLOW_QUEUE_NAME, { workflowId } satisfies WorkflowQueuePayload);
  }

  private async getWorkflowInstance<TInput = unknown, TState = unknown>(
    workflowId: string,
  ): Promise<ChimpbaseWorkflowInstance<TInput, TState> | null> {
    const row = await this.loadWorkflowInstanceRow(workflowId);
    if (!row) {
      return null;
    }

    const definition = this.resolveWorkflowDefinitionByNameAndVersion(
      row.workflow_name,
      row.workflow_version,
    );

    return {
      currentStepId: row.current_step_id
        ?? (hasWorkflowSteps(definition) ? definition.steps[row.current_step_index]?.id ?? null : null),
      input: JSON.parse(row.input_json) as TInput,
      lastError: row.last_error,
      state: JSON.parse(row.state_json) as TState,
      status: row.status,
      wakeAtMs: row.wake_at_ms,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      workflowVersion: row.workflow_version,
    };
  }

  private async processWorkflowQueuePayload(payload: WorkflowQueuePayload): Promise<void> {
    if (!payload || typeof payload.workflowId !== "string" || payload.workflowId.length === 0) {
      throw new Error("workflow queue payload requires workflowId");
    }

    const leaseToken = await this.claimWorkflowLease(payload.workflowId);
    if (!leaseToken) {
      return;
    }

    try {
      await this.runWorkflowInstanceUntilSuspended(payload.workflowId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failWorkflowInstance(payload.workflowId, message);
      throw error;
    } finally {
      await this.releaseWorkflowLease(payload.workflowId, leaseToken);
    }
  }

  private async runWorkflowInstanceUntilSuspended(workflowId: string): Promise<void> {
    for (let guard = 0; guard < 1_024; guard += 1) {
      const row = await this.loadWorkflowInstanceRow(workflowId);
      if (!row) {
        return;
      }

      if (row.status === "completed" || row.status === "failed") {
        return;
      }

      if (row.status === "sleeping") {
        if (row.wake_at_ms !== null && row.wake_at_ms > Date.now()) {
          return;
        }

        await this.adapter.query(
          `
            UPDATE _chimpbase_workflow_instances
            SET
              status = 'running',
              wake_at_ms = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE workflow_id = ?1
          `,
          [workflowId],
        );
        continue;
      }

      const definition = this.resolveWorkflowDefinitionByNameAndVersion(
        row.workflow_name,
        row.workflow_version,
      );
      const input = JSON.parse(row.input_json) as unknown;
      const state = JSON.parse(row.state_json) as unknown;

      if (hasWorkflowRun(definition)) {
        const directive = await definition.run(
          this.createWorkflowRunContext({
            input,
            state,
            workflowId,
          }),
        );
        const shouldContinue = await this.applyWorkflowRunDirective(workflowId, row, directive, input, state);
        if (shouldContinue) {
          continue;
        }

        return;
      }

      const step = definition.steps[row.current_step_index];

      if (!step) {
        await this.adapter.query(
          `
            UPDATE _chimpbase_workflow_instances
            SET
              status = 'completed',
              current_step_id = NULL,
              current_step_index = ?2,
              wake_at_ms = NULL,
              last_error = NULL,
              lease_token = NULL,
              lease_expires_at_ms = NULL,
              updated_at = CURRENT_TIMESTAMP,
              completed_at = CURRENT_TIMESTAMP
            WHERE workflow_id = ?1
          `,
          [workflowId, definition.steps.length],
        );
        return;
      }

      switch (step.kind) {
        case "workflow_action": {
          const args = step.args
            ? step.args({ input, state, workflowId })
            : [];
          const result = await this.invokeActionByName(step.action, args ?? []);
          const nextState = step.onResult
            ? step.onResult({ input, result, state, workflowId })
            : state;

          await this.adapter.query(
            `
              UPDATE _chimpbase_workflow_instances
              SET
                state_json = ?2,
                status = 'running',
                current_step_id = ?3,
                current_step_index = ?4,
                wake_at_ms = NULL,
                last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE workflow_id = ?1
            `,
            [
              workflowId,
              JSON.stringify(nextState ?? null),
              definition.steps[row.current_step_index + 1]?.id ?? null,
              row.current_step_index + 1,
            ],
          );
          continue;
        }

        case "workflow_sleep": {
          const rawDelayMs = typeof step.delayMs === "function"
            ? step.delayMs({ input, state, workflowId })
            : step.delayMs;
          const delayMs = Math.max(0, Math.floor(rawDelayMs));

          if (delayMs === 0) {
            await this.adapter.query(
              `
                UPDATE _chimpbase_workflow_instances
                SET
                  current_step_id = ?2,
                  current_step_index = ?3,
                  updated_at = CURRENT_TIMESTAMP
                WHERE workflow_id = ?1
              `,
              [
                workflowId,
                definition.steps[row.current_step_index + 1]?.id ?? null,
                row.current_step_index + 1,
              ],
            );
            continue;
          }

          await this.adapter.query(
            `
              UPDATE _chimpbase_workflow_instances
              SET
                status = 'sleeping',
                current_step_id = ?2,
                current_step_index = ?3,
                wake_at_ms = ?4,
                last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE workflow_id = ?1
            `,
            [
              workflowId,
              definition.steps[row.current_step_index + 1]?.id ?? null,
              row.current_step_index + 1,
              Date.now() + delayMs,
            ],
          );
          await this.adapter.queueSend(
            INTERNAL_WORKFLOW_QUEUE_NAME,
            { workflowId } satisfies WorkflowQueuePayload,
            { delayMs },
          );
          return;
        }

        case "workflow_wait_for_signal": {
          const signal = await this.findPendingWorkflowSignal(workflowId, step.signal);
          if (signal) {
            await this.adapter.query(
              `
                UPDATE _chimpbase_workflow_signals
                SET consumed_at = CURRENT_TIMESTAMP
                WHERE id = ?1 AND consumed_at IS NULL
              `,
              [signal.id],
            );

            const payloadValue = JSON.parse(signal.payload_json) as unknown;
            const nextState = step.onSignal
              ? step.onSignal({
                input,
                payload: payloadValue,
                state,
                workflowId,
              })
              : state;

            await this.adapter.query(
              `
                UPDATE _chimpbase_workflow_instances
                SET
                  state_json = ?2,
                  status = 'running',
                  current_step_id = ?3,
                  current_step_index = ?4,
                  wake_at_ms = NULL,
                  last_error = NULL,
                  updated_at = CURRENT_TIMESTAMP
                WHERE workflow_id = ?1
              `,
              [
                workflowId,
                JSON.stringify(nextState ?? null),
                definition.steps[row.current_step_index + 1]?.id ?? null,
                row.current_step_index + 1,
              ],
            );
            continue;
          }

          const timeoutMs = typeof step.timeoutMs === "function"
            ? step.timeoutMs({ input, state, workflowId })
            : step.timeoutMs;
          const wakeAtMs = typeof timeoutMs === "number"
            ? Date.now() + Math.max(0, Math.floor(timeoutMs))
            : null;

          if (row.status === "waiting_signal") {
            if (row.wake_at_ms !== null && row.wake_at_ms <= Date.now()) {
              await this.handleWorkflowSignalTimeout(workflowId, row, step, input, state);
              continue;
            }

            return;
          }

          if (wakeAtMs !== null && wakeAtMs <= Date.now()) {
            await this.handleWorkflowSignalTimeout(workflowId, row, step, input, state);
            continue;
          }

          await this.adapter.query(
            `
              UPDATE _chimpbase_workflow_instances
              SET
                status = 'waiting_signal',
                current_step_id = ?2,
                wake_at_ms = ?3,
                last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE workflow_id = ?1
            `,
            [workflowId, step.id, wakeAtMs],
          );
          if (wakeAtMs !== null) {
            await this.adapter.queueSend(
              INTERNAL_WORKFLOW_QUEUE_NAME,
              { workflowId } satisfies WorkflowQueuePayload,
              { delayMs: Math.max(0, wakeAtMs - Date.now()) },
            );
          }
          return;
        }
      }
    }

    throw new Error(`workflow exceeded maximum step iterations: ${workflowId}`);
  }

  private createWorkflowRunContext<TInput = unknown, TState = unknown>(
    params: ChimpbaseWorkflowRuntimeState<TInput, TState>,
  ): ChimpbaseWorkflowRunContext<TInput, TState> {
    return {
      ...params,
      action: async <TResult = unknown>(name: string, ...args: unknown[]): Promise<TResult> =>
        await this.invokeActionByName<TResult>(name, args),
      complete: (state = params.state, options) => ({
        kind: "workflow_complete" as const,
        state,
        stepId: options?.stepId,
      }),
      fail: (error: string, options) => ({
        error,
        kind: "workflow_fail" as const,
        state: options?.state ?? params.state,
        stepId: options?.stepId,
      }),
      sleep: (delayMs: number, options) => ({
        delayMs: Math.max(0, Math.floor(delayMs)),
        kind: "workflow_sleep_directive" as const,
        state: options?.state ?? params.state,
        stepId: options?.stepId,
      }),
      transition: (state: TState, options) => ({
        kind: "workflow_transition" as const,
        state,
        stepId: options?.stepId,
      }),
      waitForSignal: <TPayload = unknown>(
        signal: string,
        options: Omit<ChimpbaseWorkflowWaitForSignalDirective<TInput, TState, TPayload>, "kind" | "signal" | "state"> & { state?: TState } = {},
      ) => ({
        kind: "workflow_wait_for_signal_directive" as const,
        onSignal: options.onSignal,
        onTimeout: options.onTimeout,
        signal,
        state: options.state ?? params.state,
        stepId: options.stepId,
        timeoutMs: options.timeoutMs,
      }),
    };
  }

  private async applyWorkflowRunDirective(
    workflowId: string,
    row: PersistedWorkflowInstanceRow,
    directive: WorkflowRunDirective,
    input: unknown,
    state: unknown,
  ): Promise<boolean> {
    if (!directive || typeof directive !== "object" || !("kind" in directive)) {
      throw new Error(`workflow run must return a directive: ${workflowId}`);
    }

    switch (directive.kind) {
      case "workflow_transition": {
        await this.adapter.query(
          `
            UPDATE _chimpbase_workflow_instances
            SET
              state_json = ?2,
              status = 'running',
              current_step_id = ?3,
              current_step_index = 0,
              wake_at_ms = NULL,
              last_error = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE workflow_id = ?1
          `,
          [workflowId, JSON.stringify(directive.state ?? null), directive.stepId ?? null],
        );
        return true;
      }

      case "workflow_complete": {
        await this.adapter.query(
          `
            UPDATE _chimpbase_workflow_instances
            SET
              state_json = ?2,
              status = 'completed',
              current_step_id = NULL,
              current_step_index = 0,
              wake_at_ms = NULL,
              last_error = NULL,
              lease_token = NULL,
              lease_expires_at_ms = NULL,
              updated_at = CURRENT_TIMESTAMP,
              completed_at = CURRENT_TIMESTAMP
            WHERE workflow_id = ?1
          `,
          [workflowId, JSON.stringify(directive.state ?? null)],
        );
        return false;
      }

      case "workflow_fail": {
        await this.adapter.query(
          `
            UPDATE _chimpbase_workflow_instances
            SET
              state_json = ?2,
              status = 'failed',
              current_step_id = ?3,
              wake_at_ms = NULL,
              last_error = ?4,
              lease_token = NULL,
              lease_expires_at_ms = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE workflow_id = ?1
          `,
          [
            workflowId,
            JSON.stringify(directive.state ?? null),
            directive.stepId ?? null,
            directive.error,
          ],
        );
        return false;
      }

      case "workflow_sleep_directive": {
        if (directive.delayMs <= 0) {
          await this.adapter.query(
            `
              UPDATE _chimpbase_workflow_instances
              SET
                state_json = ?2,
                status = 'running',
                current_step_id = ?3,
                current_step_index = 0,
                wake_at_ms = NULL,
                last_error = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE workflow_id = ?1
            `,
            [workflowId, JSON.stringify(directive.state ?? null), directive.stepId ?? null],
          );
          return true;
        }

        await this.adapter.query(
          `
            UPDATE _chimpbase_workflow_instances
            SET
              state_json = ?2,
              status = 'sleeping',
              current_step_id = ?3,
              current_step_index = 0,
              wake_at_ms = ?4,
              last_error = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE workflow_id = ?1
          `,
          [
            workflowId,
            JSON.stringify(directive.state ?? null),
            directive.stepId ?? null,
            Date.now() + directive.delayMs,
          ],
        );
        await this.adapter.queueSend(
          INTERNAL_WORKFLOW_QUEUE_NAME,
          { workflowId } satisfies WorkflowQueuePayload,
          { delayMs: directive.delayMs },
        );
        return false;
      }

      case "workflow_wait_for_signal_directive":
        return await this.applyWorkflowWaitForSignalDirective(workflowId, row, directive, input, state);
    }
  }

  private async applyWorkflowWaitForSignalDirective(
    workflowId: string,
    row: PersistedWorkflowInstanceRow,
    directive: Extract<WorkflowRunDirective, { kind: "workflow_wait_for_signal_directive" }>,
    input: unknown,
    state: unknown,
  ): Promise<boolean> {
    const signal = await this.findPendingWorkflowSignal(workflowId, directive.signal);
    if (signal) {
      await this.adapter.query(
        `
          UPDATE _chimpbase_workflow_signals
          SET consumed_at = CURRENT_TIMESTAMP
          WHERE id = ?1 AND consumed_at IS NULL
        `,
        [signal.id],
      );

      const payloadValue = JSON.parse(signal.payload_json) as unknown;
      const nextState = directive.onSignal
        ? directive.onSignal({
          input,
          payload: payloadValue,
          state,
          workflowId,
        })
        : state;

      await this.adapter.query(
        `
          UPDATE _chimpbase_workflow_instances
          SET
            state_json = ?2,
            status = 'running',
            current_step_id = ?3,
            current_step_index = 0,
            wake_at_ms = NULL,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE workflow_id = ?1
        `,
        [workflowId, JSON.stringify(nextState ?? null), directive.stepId ?? null],
      );
      return true;
    }

    const timeoutMs = typeof directive.timeoutMs === "function"
      ? directive.timeoutMs({ input, state, workflowId })
      : directive.timeoutMs;
    const wakeAtMs = typeof timeoutMs === "number"
      ? Date.now() + Math.max(0, Math.floor(timeoutMs))
      : null;

    if (row.status === "waiting_signal") {
      if (row.wake_at_ms !== null && row.wake_at_ms <= Date.now()) {
        return await this.handleWorkflowRunSignalTimeout(workflowId, directive, input, state);
      }

      return false;
    }

    if (wakeAtMs !== null && wakeAtMs <= Date.now()) {
      return await this.handleWorkflowRunSignalTimeout(workflowId, directive, input, state);
    }

    await this.adapter.query(
      `
        UPDATE _chimpbase_workflow_instances
        SET
          state_json = ?2,
          status = 'waiting_signal',
          current_step_id = ?3,
          current_step_index = 0,
          wake_at_ms = ?4,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE workflow_id = ?1
      `,
      [
        workflowId,
        JSON.stringify(directive.state ?? null),
        directive.stepId ?? directive.signal,
        wakeAtMs,
      ],
    );
    if (wakeAtMs !== null) {
      await this.adapter.queueSend(
        INTERNAL_WORKFLOW_QUEUE_NAME,
        { workflowId } satisfies WorkflowQueuePayload,
        { delayMs: Math.max(0, wakeAtMs - Date.now()) },
      );
    }

    return false;
  }

  private async handleWorkflowRunSignalTimeout(
    workflowId: string,
    directive: Extract<WorkflowRunDirective, { kind: "workflow_wait_for_signal_directive" }>,
    input: unknown,
    state: unknown,
  ): Promise<boolean> {
    if (directive.onTimeout === "fail") {
      await this.adapter.query(
        `
          UPDATE _chimpbase_workflow_instances
          SET
            status = 'failed',
            current_step_id = ?2,
            wake_at_ms = NULL,
            last_error = ?3,
            lease_token = NULL,
            lease_expires_at_ms = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE workflow_id = ?1
        `,
        [workflowId, directive.stepId ?? directive.signal, `workflow signal timed out: ${workflowId}/${directive.signal}`],
      );
      return false;
    }

    const nextState = typeof directive.onTimeout === "function"
      ? directive.onTimeout({ input, state, workflowId })
      : state;

    await this.adapter.query(
      `
        UPDATE _chimpbase_workflow_instances
        SET
          state_json = ?2,
          status = 'running',
          current_step_id = ?3,
          current_step_index = 0,
          wake_at_ms = NULL,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE workflow_id = ?1
      `,
      [workflowId, JSON.stringify(nextState ?? null), directive.stepId ?? null],
    );
    return true;
  }

  private async handleWorkflowSignalTimeout(
    workflowId: string,
    row: PersistedWorkflowInstanceRow,
    step: Extract<ChimpbaseWorkflowStepDefinition, { kind: "workflow_wait_for_signal" }>,
    input: unknown,
    state: unknown,
  ): Promise<void> {
    const definition = this.resolveWorkflowDefinitionByNameAndVersion(
      row.workflow_name,
      row.workflow_version,
    );
    const nextStepId = hasWorkflowSteps(definition)
      ? definition.steps[row.current_step_index + 1]?.id ?? null
      : null;

    if (step.onTimeout === "fail") {
      throw new Error(`workflow signal timed out: ${workflowId}/${step.signal}`);
    }

    const nextState = typeof step.onTimeout === "function"
      ? step.onTimeout({ input, state, workflowId })
      : state;

    await this.adapter.query(
      `
        UPDATE _chimpbase_workflow_instances
        SET
          state_json = ?2,
          status = 'running',
          current_step_id = ?3,
          current_step_index = ?4,
          wake_at_ms = NULL,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE workflow_id = ?1
      `,
      [
        workflowId,
        JSON.stringify(nextState ?? null),
        nextStepId,
        row.current_step_index + 1,
      ],
    );
  }

  private async loadWorkflowInstanceRow(workflowId: string): Promise<PersistedWorkflowInstanceRow | null> {
    const [row] = await this.adapter.query<PersistedWorkflowInstanceRow>(
      `
        SELECT
          current_step_id,
          workflow_id,
          workflow_name,
          workflow_version,
          status,
          input_json,
          state_json,
          current_step_index,
          wake_at_ms,
          last_error
        FROM _chimpbase_workflow_instances
        WHERE workflow_id = ?1
        LIMIT 1
      `,
      [workflowId],
    );

    return row ?? null;
  }

  private resolveWorkflowDefinition<TInput = unknown, TState = unknown>(
    reference:
      | string
      | ChimpbaseWorkflowDefinition<TInput, TState>
      | ChimpbaseWorkflowRegistration<TInput, TState>,
  ): ChimpbaseWorkflowDefinition<TInput, TState> {
    if (typeof reference === "string") {
      const versions = this.registry.workflows.get(reference);
      if (!versions || versions.size === 0) {
        throw new Error(`workflow not found: ${reference}`);
      }

      const latestVersion = Math.max(...versions.keys());
      return versions.get(latestVersion) as ChimpbaseWorkflowDefinition<TInput, TState>;
    }

    if ("definition" in reference) {
      return reference.definition;
    }

    return reference;
  }

  private resolveWorkflowDefinitionByNameAndVersion(
    workflowName: string,
    workflowVersion: number,
  ): ChimpbaseWorkflowDefinition {
    const versions = this.registry.workflows.get(workflowName);
    const definition = versions?.get(workflowVersion);

    if (!definition) {
      throw new Error(`workflow definition not found: ${workflowName}@${workflowVersion}`);
    }

    return definition;
  }

  private async claimWorkflowLease(workflowId: string): Promise<string | null> {
    const now = Date.now();
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAtMs = now + this.worker.leaseMs;

    const [row] = await this.adapter.query<{ workflow_id: string }>(
      `
        UPDATE _chimpbase_workflow_instances
        SET
          lease_token = ?2,
          lease_expires_at_ms = ?3,
          updated_at = CURRENT_TIMESTAMP
        WHERE workflow_id = ?1
          AND status IN ('running', 'sleeping', 'waiting_signal')
          AND (
            lease_token IS NULL
            OR lease_expires_at_ms IS NULL
            OR lease_expires_at_ms <= ?4
          )
        RETURNING workflow_id
      `,
      [workflowId, leaseToken, leaseExpiresAtMs, now],
    );

    return row ? leaseToken : null;
  }

  private async releaseWorkflowLease(workflowId: string, leaseToken: string): Promise<void> {
    await this.adapter.query(
      `
        UPDATE _chimpbase_workflow_instances
        SET
          lease_token = NULL,
          lease_expires_at_ms = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE workflow_id = ?1 AND lease_token = ?2
      `,
      [workflowId, leaseToken],
    );
  }

  private async failWorkflowInstance(workflowId: string, errorMessage: string): Promise<void> {
    await this.adapter.query(
      `
        UPDATE _chimpbase_workflow_instances
        SET
          status = 'failed',
          wake_at_ms = NULL,
          last_error = ?2,
          lease_token = NULL,
          lease_expires_at_ms = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE workflow_id = ?1
      `,
      [workflowId, errorMessage],
    );
  }

  private async findPendingWorkflowSignal(
    workflowId: string,
    signalName: string,
  ): Promise<PersistedWorkflowSignalRow | null> {
    const [row] = await this.adapter.query<PersistedWorkflowSignalRow>(
      `
        SELECT
          id,
          payload_json
        FROM _chimpbase_workflow_signals
        WHERE workflow_id = ?1
          AND signal_name = ?2
          AND consumed_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      `,
      [workflowId, signalName],
    );

    return row ?? null;
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

function hasWorkflowRun<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDefinition<TInput, TState>,
): definition is ChimpbaseWorkflowDefinition<TInput, TState> & { run: NonNullable<ChimpbaseWorkflowDefinition<TInput, TState>["run"]> } {
  return typeof (definition as { run?: unknown }).run === "function";
}

function hasWorkflowSteps<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDefinition<TInput, TState>,
): definition is ChimpbaseWorkflowDefinition<TInput, TState> & ChimpbaseWorkflowStepsDraftDefinition<TInput, TState> {
  return Array.isArray((definition as { steps?: unknown }).steps);
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
