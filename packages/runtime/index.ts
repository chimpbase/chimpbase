import { AsyncLocalStorage } from "node:async_hooks";
import type { Kysely } from "kysely";

export type ChimpbaseRow = Record<string, unknown>;
export type ChimpbaseQueryResult<T = ChimpbaseRow> = T[];
export type ChimpbaseTelemetryAttributes = Record<string, string | number | boolean | null>;

export interface ChimpbaseActionDefinition<
  TArgs = unknown,
  TResult = unknown,
> {
  args: TArgs;
  result: TResult;
}

export interface ChimpbaseValidator<TValue = unknown> {
  readonly isOptional?: true;
  readonly schema: unknown;
  array(): ChimpbaseValidator<TValue[]>;
  nullable(): ChimpbaseValidator<TValue | null>;
  optional(): ChimpbaseValidator<TValue | undefined>;
  parse(value: unknown, path?: string): TValue;
}

export type Infer<TValidator extends ChimpbaseValidator<any>> =
  TValidator extends ChimpbaseValidator<infer TValue> ? TValue : never;

type ChimpbaseActionMap = Record<string, ChimpbaseActionDefinition<any, any>>;

export interface ChimpbaseActionRegistry extends ChimpbaseActionMap {}

type ChimpbaseRegisteredActions<TActions extends ChimpbaseActionMap> = TActions;
type ChimpbaseKnownActionName<TActions extends ChimpbaseActionMap> =
  Extract<keyof ChimpbaseRegisteredActions<TActions>, string>;
type ChimpbaseActionArgs<
  TActions extends ChimpbaseActionMap,
  TName extends ChimpbaseKnownActionName<TActions>,
> =
  ChimpbaseRegisteredActions<TActions>[TName] extends ChimpbaseActionDefinition<infer TArgs, unknown>
    ? TArgs
    : never;
type ChimpbaseActionCallArgs<TArgs> = TArgs extends readonly unknown[] ? TArgs : [TArgs];
type ChimpbaseActionResult<
  TActions extends ChimpbaseActionMap,
  TName extends ChimpbaseKnownActionName<TActions>,
> =
  ChimpbaseRegisteredActions<TActions>[TName] extends ChimpbaseActionDefinition<unknown, infer TResult>
    ? TResult
    : never;

type ChimpbaseActionDefinitionFromMethod<TValue> =
  TValue extends (ctx: ChimpbaseContext<any>, ...args: infer TArgs) => infer TResult
    ? ChimpbaseActionDefinition<TArgs, Awaited<TResult>>
    : never;

type ChimpbaseActionDefinitionFromRegistration<TValue> =
  TValue extends ChimpbaseActionRegistration<infer TArgs, infer TResult, any>
    ? ChimpbaseActionDefinition<TArgs, TResult>
    : never;

type ChimpbaseActionDefinitionFromValue<TValue> =
  ChimpbaseActionDefinitionFromRegistration<TValue> extends never
    ? ChimpbaseActionDefinitionFromMethod<TValue>
    : ChimpbaseActionDefinitionFromRegistration<TValue>;

type ChimpbaseActionValueKeys<TValue> = Extract<{
  [TKey in keyof TValue]: ChimpbaseActionDefinitionFromValue<TValue[TKey]> extends never ? never : TKey;
}[keyof TValue], string>;

type ChimpbaseActionsFromModule<TModule> = {
  [TKey in ChimpbaseActionValueKeys<TModule>]: ChimpbaseActionDefinitionFromValue<TModule[TKey]>;
};

type ChimpbaseUnionToIntersection<TValue> =
  (TValue extends unknown ? (value: TValue) => void : never) extends (value: infer TIntersection) => void
    ? TIntersection
    : never;

type ChimpbaseSimplify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
};

export type InferActionsFromModules<TModules extends readonly unknown[]> = ChimpbaseSimplify<
  ChimpbaseUnionToIntersection<ChimpbaseActionsFromModule<TModules[number]>>
>;

export type InferActionsFromRecord<TRecord> = ChimpbaseSimplify<{
  [TKey in ChimpbaseActionValueKeys<TRecord>]: ChimpbaseActionDefinitionFromValue<TRecord[TKey]>;
}>;

export interface ChimpbaseTraceSpan {
  setAttribute(key: string, value: string | number | boolean | null): void;
}

export interface ChimpbaseQueueEnqueueOptions {
  delayMs?: number;
}

export interface ChimpbaseWorkerDefinition {
  dlq?: false | string;
}

export interface ChimpbaseCronInvocation {
  fireAt: string;
  fireAtMs: number;
  name: string;
  schedule: string;
}

export interface ChimpbaseDlqEnvelope<TPayload = unknown> {
  attempts: number;
  error: string;
  failedAt: string;
  payload: TPayload;
  queue: string;
}

export interface ChimpbaseQueueClient {
  enqueue<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: ChimpbaseQueueEnqueueOptions,
  ): Promise<void>;
}

export interface ChimpbaseWorkflowRuntimeState<TInput = unknown, TState = unknown> {
  input: TInput;
  state: TState;
  workflowId: string;
}

export interface ChimpbaseWorkflowActionStepResult<TInput = unknown, TState = unknown, TResult = unknown> {
  input: TInput;
  result: TResult;
  state: TState;
  workflowId: string;
}

export interface ChimpbaseWorkflowSignalStepResult<TInput = unknown, TState = unknown, TPayload = unknown> {
  input: TInput;
  payload: TPayload;
  state: TState;
  workflowId: string;
}

export interface ChimpbaseWorkflowTimeoutStepResult<TInput = unknown, TState = unknown> {
  input: TInput;
  state: TState;
  workflowId: string;
}

export interface ChimpbaseWorkflowActionStepDefinition<
  TInput = unknown,
  TState = unknown,
  TArgs = unknown[],
  TResult = unknown,
> {
  action: string | ChimpbaseActionRegistration<TArgs, TResult, any>;
  args?: (params: ChimpbaseWorkflowRuntimeState<TInput, TState>) => TArgs;
  id: string;
  kind: "workflow_action";
  onResult?: (params: ChimpbaseWorkflowActionStepResult<TInput, TState, TResult>) => TState;
}

export interface ChimpbaseWorkflowSleepStepDefinition<
  TInput = unknown,
  TState = unknown,
> {
  delayMs: number | ((params: ChimpbaseWorkflowRuntimeState<TInput, TState>) => number);
  id: string;
  kind: "workflow_sleep";
}

export interface ChimpbaseWorkflowWaitForSignalStepDefinition<
  TInput = unknown,
  TState = unknown,
  TPayload = unknown,
> {
  id: string;
  kind: "workflow_wait_for_signal";
  onSignal?: (params: ChimpbaseWorkflowSignalStepResult<TInput, TState, TPayload>) => TState;
  onTimeout?:
    | "continue"
    | "fail"
    | ((params: ChimpbaseWorkflowTimeoutStepResult<TInput, TState>) => TState);
  signal: string;
  timeoutMs?: number | ((params: ChimpbaseWorkflowRuntimeState<TInput, TState>) => number);
}

export type ChimpbaseWorkflowStepDefinition<TInput = unknown, TState = unknown> =
  | ChimpbaseWorkflowActionStepDefinition<TInput, TState, unknown, unknown>
  | ChimpbaseWorkflowSleepStepDefinition<TInput, TState>
  | ChimpbaseWorkflowWaitForSignalStepDefinition<TInput, TState, unknown>;

export interface ChimpbaseWorkflowTransitionDirective<TState = unknown> {
  kind: "workflow_transition";
  state: TState;
  stepId?: string;
}

export interface ChimpbaseWorkflowCompleteDirective<TState = unknown> {
  kind: "workflow_complete";
  state: TState;
  stepId?: string;
}

export interface ChimpbaseWorkflowFailDirective<TState = unknown> {
  error: string;
  kind: "workflow_fail";
  state: TState;
  stepId?: string;
}

export interface ChimpbaseWorkflowSleepDirective<TState = unknown> {
  delayMs: number;
  kind: "workflow_sleep_directive";
  state: TState;
  stepId?: string;
}

export interface ChimpbaseWorkflowWaitForSignalDirective<
  TInput = unknown,
  TState = unknown,
  TPayload = unknown,
> {
  kind: "workflow_wait_for_signal_directive";
  onSignal?: (params: ChimpbaseWorkflowSignalStepResult<TInput, TState, TPayload>) => TState;
  onTimeout?:
    | "continue"
    | "fail"
    | ((params: ChimpbaseWorkflowTimeoutStepResult<TInput, TState>) => TState);
  signal: string;
  state: TState;
  stepId?: string;
  timeoutMs?: number | ((params: ChimpbaseWorkflowRuntimeState<TInput, TState>) => number);
}

export type ChimpbaseWorkflowRunResult<TInput = unknown, TState = unknown> =
  | ChimpbaseWorkflowCompleteDirective<TState>
  | ChimpbaseWorkflowFailDirective<TState>
  | ChimpbaseWorkflowSleepDirective<TState>
  | ChimpbaseWorkflowTransitionDirective<TState>
  | ChimpbaseWorkflowWaitForSignalDirective<TInput, TState, unknown>;

export interface ChimpbaseWorkflowRunContext<TInput = unknown, TState = unknown>
  extends ChimpbaseWorkflowRuntimeState<TInput, TState> {
  action<TAction extends ChimpbaseActionRegistration<any, any, any>>(
    reference: TAction,
    ...args: ChimpbaseActionCallArgs<ChimpbaseInferActionArgs<TAction>>
  ): Promise<ChimpbaseInferActionResult<TAction>>;
  action<TResult = unknown>(name: string, ...args: unknown[]): Promise<TResult>;
  complete(state?: TState, options?: { stepId?: string }): ChimpbaseWorkflowCompleteDirective<TState>;
  fail(error: string, options?: { state?: TState; stepId?: string }): ChimpbaseWorkflowFailDirective<TState>;
  sleep(delayMs: number, options?: { state?: TState; stepId?: string }): ChimpbaseWorkflowSleepDirective<TState>;
  transition(state: TState, options?: { stepId?: string }): ChimpbaseWorkflowTransitionDirective<TState>;
  waitForSignal<TPayload = unknown>(
    signal: string,
    options?: Omit<ChimpbaseWorkflowWaitForSignalDirective<TInput, TState, TPayload>, "kind" | "signal" | "state">
      & { state?: TState },
  ): ChimpbaseWorkflowWaitForSignalDirective<TInput, TState, TPayload>;
}

export interface ChimpbaseWorkflowStepsDraftDefinition<TInput = unknown, TState = unknown> {
  initialState(input: TInput): TState;
  inputSchema?: unknown;
  name: string;
  run?: never;
  signalSchemas?: Record<string, unknown>;
  stateSchema?: unknown;
  steps: readonly ChimpbaseWorkflowStepDefinition<TInput, TState>[];
}

export interface ChimpbaseWorkflowRunDraftDefinition<TInput = unknown, TState = unknown> {
  initialState(input: TInput): TState;
  inputSchema?: unknown;
  name: string;
  run(
    workflow: ChimpbaseWorkflowRunContext<TInput, TState>,
  ): ChimpbaseWorkflowRunResult<TInput, TState> | Promise<ChimpbaseWorkflowRunResult<TInput, TState>>;
  signalSchemas?: Record<string, unknown>;
  stateSchema?: unknown;
  steps?: never;
}

export type ChimpbaseWorkflowDraftDefinition<TInput = unknown, TState = unknown> =
  | ChimpbaseWorkflowRunDraftDefinition<TInput, TState>
  | ChimpbaseWorkflowStepsDraftDefinition<TInput, TState>;

export type ChimpbaseWorkflowDefinition<TInput = unknown, TState = unknown> =
  (ChimpbaseWorkflowRunDraftDefinition<TInput, TState> | ChimpbaseWorkflowStepsDraftDefinition<TInput, TState>)
  & {
    version: number;
  };

export interface ChimpbaseWorkflowRegistration<TInput = unknown, TState = unknown> {
  definition: ChimpbaseWorkflowDefinition<TInput, TState>;
  kind: "workflow";
}

export interface ChimpbaseWorkflowStartOptions {
  workflowId?: string;
}

export interface ChimpbaseWorkflowStartResult {
  status: "completed" | "failed" | "running" | "sleeping" | "waiting_signal";
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
}

export interface ChimpbaseWorkflowInstance<
  TInput = unknown,
  TState = unknown,
> extends ChimpbaseWorkflowStartResult {
  currentStepId: string | null;
  input: TInput;
  lastError: string | null;
  state: TState;
  wakeAtMs: number | null;
}

export interface ChimpbaseWorkflowClient {
  get<TInput = unknown, TState = unknown>(
    workflowId: string,
  ): Promise<ChimpbaseWorkflowInstance<TInput, TState> | null>;
  signal<TPayload = unknown>(
    workflowId: string,
    signalName: string,
    payload: TPayload,
  ): Promise<void>;
  start<TInput = unknown, TState = unknown>(
    definition:
      | string
      | ChimpbaseWorkflowDefinition<TInput, TState>
      | ChimpbaseWorkflowRegistration<TInput, TState>,
    input: TInput,
    options?: ChimpbaseWorkflowStartOptions,
  ): Promise<ChimpbaseWorkflowStartResult>;
}

export interface ChimpbaseKvListOptions {
  prefix?: string;
}

export interface ChimpbaseKvClient {
  delete(key: string): Promise<void>;
  get<TValue = unknown>(key: string): Promise<TValue | null>;
  list(options?: ChimpbaseKvListOptions): Promise<string[]>;
  set<TValue = unknown>(key: string, value: TValue): Promise<void>;
}

export interface ChimpbaseCollectionFindOptions {
  limit?: number;
}

export type ChimpbaseCollectionFilter = Record<string, unknown>;
export type ChimpbaseCollectionPatch = Record<string, unknown>;

export interface ChimpbaseCollectionClient {
  delete(name: string, filter?: ChimpbaseCollectionFilter): Promise<number>;
  find<TDocument = Record<string, unknown>>(
    name: string,
    filter?: ChimpbaseCollectionFilter,
    options?: ChimpbaseCollectionFindOptions,
  ): Promise<TDocument[]>;
  findOne<TDocument = Record<string, unknown>>(
    name: string,
    filter: ChimpbaseCollectionFilter,
  ): Promise<TDocument | null>;
  insert<TDocument extends Record<string, unknown>>(
    name: string,
    document: TDocument,
  ): Promise<string>;
  list(): Promise<string[]>;
  update(
    name: string,
    filter: ChimpbaseCollectionFilter,
    patch: ChimpbaseCollectionPatch,
  ): Promise<number>;
}

export interface ChimpbaseStreamReadOptions {
  limit?: number;
  sinceId?: number;
}

export interface ChimpbaseStreamEvent<TPayload = unknown> {
  createdAt: string;
  event: string;
  id: number;
  payload: TPayload;
  stream: string;
}

export interface ChimpbaseStreamClient {
  append<TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number>;
  read<TPayload = unknown>(
    stream: string,
    options?: ChimpbaseStreamReadOptions,
  ): Promise<ChimpbaseStreamEvent<TPayload>[]>;
}

export interface ChimpbasePubSubClient {
  publish<TPayload = unknown>(topic: string, payload: TPayload): void;
}

export interface ChimpbaseLogger {
  debug(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
  info(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
  warn(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
  error(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
}

export interface ChimpbaseContext<TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry> {
  db<TDatabase = Record<string, never>>(): Kysely<TDatabase>;
  query<T = ChimpbaseRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<ChimpbaseQueryResult<T>>;
  pubsub: ChimpbasePubSubClient;
  secret(name: string): string | null;
  kv: ChimpbaseKvClient;
  collection: ChimpbaseCollectionClient;
  stream: ChimpbaseStreamClient;
  queue: ChimpbaseQueueClient;
  workflow: ChimpbaseWorkflowClient;
  log: ChimpbaseLogger;
  metric(
    name: string,
    value: number,
    labels?: ChimpbaseTelemetryAttributes,
  ): void;
  trace<TResult>(
    name: string,
    callback: (span: ChimpbaseTraceSpan) => TResult | Promise<TResult>,
    attributes?: ChimpbaseTelemetryAttributes,
  ): Promise<TResult>;
  action<TAction extends ChimpbaseActionRegistration<any, any, any>>(
    reference: TAction,
    ...args: ChimpbaseActionCallArgs<ChimpbaseInferActionArgs<TAction>>
  ): Promise<ChimpbaseInferActionResult<TAction>>;
  action<TName extends ChimpbaseKnownActionName<TActions>>(
    name: TName,
    ...args: ChimpbaseActionCallArgs<ChimpbaseActionArgs<TActions, TName>>
  ): Promise<ChimpbaseActionResult<TActions, TName>>;
  action<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    ...args: TArgs
  ): Promise<TResult>;
}

export interface ChimpbaseRouteEnv<TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry> {
  action<TAction extends ChimpbaseActionRegistration<any, any, any>>(
    reference: TAction,
    ...args: ChimpbaseActionCallArgs<ChimpbaseInferActionArgs<TAction>>
  ): Promise<ChimpbaseInferActionResult<TAction>>;
  action<TName extends ChimpbaseKnownActionName<TActions>>(
    name: TName,
    ...args: ChimpbaseActionCallArgs<ChimpbaseActionArgs<TActions, TName>>
  ): Promise<ChimpbaseActionResult<TActions, TName>>;
  action<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    ...args: TArgs
  ): Promise<TResult>;
}

export type ChimpbaseTupleActionHandler<
  TArgs extends readonly unknown[] = unknown[],
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  ...args: TArgs
) => Promise<TResult> | TResult;

export type ChimpbaseObjectActionHandler<
  TArgs = unknown,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  args: TArgs,
) => Promise<TResult> | TResult;

export type ChimpbaseActionHandler<
  TArgs = unknown[],
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> =
  TArgs extends readonly unknown[]
    ? ChimpbaseTupleActionHandler<TArgs, TResult, TActions>
    : ChimpbaseObjectActionHandler<TArgs, TResult, TActions>;

type ChimpbaseActionMethod<TThis, TArgs extends unknown[] = unknown[], TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  ...args: TArgs
) => TResult | Promise<TResult>;

export type ChimpbaseSubscriptionHandler<
  TPayload = unknown,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  payload: TPayload,
) => Promise<TResult> | TResult;

type ChimpbaseSubscriptionMethod<TThis, TPayload = unknown, TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  payload: TPayload,
) => TResult | Promise<TResult>;

export type ChimpbaseWorkerHandler<
  TPayload = unknown,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  payload: TPayload,
) => Promise<TResult> | TResult;

type ChimpbaseWorkerMethod<TThis, TPayload = unknown, TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  payload: TPayload,
) => TResult | Promise<TResult>;

export type ChimpbaseCronHandler<
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  invocation: ChimpbaseCronInvocation,
) => Promise<TResult> | TResult;

type ChimpbaseCronMethod<TThis, TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  invocation: ChimpbaseCronInvocation,
) => TResult | Promise<TResult>;

export type ChimpbaseRouteHandler<TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry> = (
  request: Request,
  env: ChimpbaseRouteEnv<TActions>,
) => Response | Promise<Response>;

export interface ChimpbaseRegistrationTarget {
  bindActionInvoker?(reference: ChimpbaseActionRegistration<any, any, any>): void;
  registerAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseTupleActionHandler<TArgs, TResult>,
    definition?: { args?: undefined },
  ): ChimpbaseTupleActionHandler<TArgs, TResult>;
  registerAction<TArgs, TResult = unknown>(
    name: string,
    handler: ChimpbaseObjectActionHandler<TArgs, TResult>,
    definition: { args: ChimpbaseValidator<TArgs> },
  ): ChimpbaseObjectActionHandler<TArgs, TResult>;
  registerSubscription<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
    options?: ChimpbaseSubscriptionOptions,
  ): ChimpbaseSubscriptionHandler<TPayload, TResult>;
  registerWorker<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseWorkerHandler<TPayload, TResult>,
    definition?: ChimpbaseWorkerDefinition,
  ): ChimpbaseWorkerHandler<TPayload, TResult>;
  registerCron?<TResult = unknown>(
    name: string,
    schedule: string,
    handler: ChimpbaseCronHandler<TResult>,
  ): ChimpbaseCronHandler<TResult>;
  registerWorkflow<TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ): ChimpbaseWorkflowDefinition<TInput, TState>;
  setTelemetryOverride?(key: string, value: ChimpbaseTelemetryPersistOption): void;
}

export type ChimpbaseTelemetryPersistOption =
  | boolean
  | { log?: boolean; metric?: boolean; trace?: boolean };

export type ChimpbaseActionInvoker = <TResult = unknown>(
  nameOrReference: string | ChimpbaseActionRegistration<any, any, any>,
  args: unknown[],
) => Promise<TResult>;

export interface ChimpbaseActionRegistration<
  TArgs = unknown[],
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> {
  (...args: ChimpbaseActionCallArgs<TArgs>): Promise<TResult>;
  args?: ChimpbaseValidator<TArgs>;
  kind: "action";
  handler: ChimpbaseActionHandler<TArgs, TResult, TActions>;
  name: string;
  telemetry?: ChimpbaseTelemetryPersistOption;
}

export type ChimpbaseActionReference<
  TArgs = unknown[],
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = ChimpbaseActionRegistration<TArgs, TResult, TActions>;

export type ChimpbaseInferActionArgs<TAction> =
  TAction extends ChimpbaseActionRegistration<infer TArgs, any, any> ? TArgs : never;

export type ChimpbaseInferActionResult<TAction> =
  TAction extends ChimpbaseActionRegistration<any, infer TResult, any> ? TResult : never;

export type ChimpbaseSubscriptionOptions =
  | { idempotent: true; name: string; telemetry?: ChimpbaseTelemetryPersistOption }
  | { idempotent?: false; name?: string; telemetry?: ChimpbaseTelemetryPersistOption };

export type ChimpbaseSubscriptionRegistration<TPayload = unknown, TResult = unknown> = {
  eventName: string;
  handler: ChimpbaseSubscriptionHandler<TPayload, TResult>;
  kind: "subscription";
  telemetry?: ChimpbaseTelemetryPersistOption;
} & (
  | { idempotent: true; name: string }
  | { idempotent?: false; name?: string }
);

export interface ChimpbaseWorkerRegistration<TPayload = unknown, TResult = unknown> {
  definition?: ChimpbaseWorkerDefinition;
  handler: ChimpbaseWorkerHandler<TPayload, TResult>;
  kind: "worker";
  name: string;
  telemetry?: ChimpbaseTelemetryPersistOption;
}

export interface ChimpbaseCronRegistration<TResult = unknown> {
  handler: ChimpbaseCronHandler<TResult>;
  kind: "cron";
  name: string;
  schedule: string;
  telemetry?: ChimpbaseTelemetryPersistOption;
}

export interface ChimpbaseWorkflowRegisteredStep {
  action?: string;
  id: string;
  kind: ChimpbaseWorkflowStepDefinition["kind"];
  signal?: string;
}

export type ChimpbaseWorkflowMode = "run" | "steps";

export type ChimpbaseWorkflowCompatibility =
  | "additive"
  | "breaking"
  | "identical"
  | "requires_migration";

export interface ChimpbaseWorkflowContract {
  hash: string;
  inputSchema?: unknown;
  mode: ChimpbaseWorkflowMode;
  name: string;
  signalSchemas?: Record<string, unknown>;
  stateSchema?: unknown;
  steps: readonly ChimpbaseWorkflowRegisteredStep[];
  version: number;
}

export interface ChimpbaseVersionedWorkflow<TInput = unknown, TState = unknown> {
  changed: boolean;
  compatibility: ChimpbaseWorkflowCompatibility;
  contract: ChimpbaseWorkflowContract;
  definition: ChimpbaseWorkflowDefinition<TInput, TState>;
}

export type ChimpbaseRegistration =
  | ChimpbaseActionRegistration<any, any>
  | ChimpbaseCronRegistration<any>
  | ChimpbaseSubscriptionRegistration<any, any>
  | ChimpbaseWorkerRegistration<any, any>
  | ChimpbaseWorkflowRegistration<any, any>;

type ChimpbaseAnyRegistration = ChimpbaseRegistration;

type ChimpbaseDecoratedOwner = object;
type ChimpbaseDecoratorMethod = (...args: any[]) => unknown;
interface ChimpbaseLegacyDecoratedEntry {
  createEntry(owner: object): ChimpbaseAnyRegistration;
}

const decoratedEntryStore = new WeakMap<ChimpbaseDecoratedOwner, ChimpbaseAnyRegistration[]>();
const legacyDecoratedEntryStore = new WeakMap<ChimpbaseDecoratedOwner, ChimpbaseLegacyDecoratedEntry[]>();
const ACTION_INVOKER_STORAGE_KEY = Symbol.for("@chimpbase/runtime.action_invoker_storage");
const ACTION_REFERENCE_INVOKERS_KEY = Symbol.for("@chimpbase/runtime.action_reference_invokers");
const actionInvokerStorage = getActionInvokerStorage();

type RuntimeGlobals = typeof globalThis & {
  defineAction?: <TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseTupleActionHandler<TArgs, TResult>,
  ) => ChimpbaseTupleActionHandler<TArgs, TResult>;
  defineSubscription?: <TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
  ) => ChimpbaseSubscriptionHandler<TPayload, TResult>;
  defineWorker?: <TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseWorkerHandler<TPayload, TResult>,
    definition?: ChimpbaseWorkerDefinition,
  ) => ChimpbaseWorkerHandler<TPayload, TResult>;
  defineCron?: <TResult = unknown>(
    name: string,
    schedule: string,
    handler: ChimpbaseCronHandler<TResult>,
  ) => ChimpbaseCronHandler<TResult>;
  defineWorkflow?: <TInput = unknown, TState = unknown>(
    definition: ChimpbaseWorkflowDefinition<TInput, TState>,
  ) => ChimpbaseWorkflowDefinition<TInput, TState>;
};

interface ChimpbaseActionOptions {
  telemetry?: ChimpbaseTelemetryPersistOption;
}

export function runWithActionInvoker<TResult>(
  invoker: ChimpbaseActionInvoker,
  callback: () => TResult | Promise<TResult>,
): TResult | Promise<TResult> {
  return actionInvokerStorage.run(invoker, callback);
}

export function bindActionInvoker(
  reference: ChimpbaseActionRegistration<any, any, any>,
  invoker: ChimpbaseActionInvoker,
): void {
  getBoundActionInvokers().set(reference, invoker);
}

interface ChimpbaseActionDefinitionInput<
  TArgs,
  TResult,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> extends ChimpbaseActionOptions {
  args: ChimpbaseValidator<TArgs>;
  handler: ChimpbaseObjectActionHandler<TArgs, TResult, TActions>;
  name?: string;
}

interface ChimpbaseActionWithoutArgsInput<
  TResult,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> extends ChimpbaseActionOptions {
  handler: ChimpbaseTupleActionHandler<[], TResult, TActions>;
  name?: string;
}

export function action<TArgs extends unknown[] = unknown[], TResult = unknown, TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry>(
  name: string,
  handler: ChimpbaseTupleActionHandler<TArgs, TResult, TActions>,
  options?: ChimpbaseActionOptions,
): ChimpbaseActionRegistration<TArgs, TResult, TActions>;
export function action<
  TValidator extends ChimpbaseValidator<any>,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
>(
  input: ChimpbaseActionDefinitionInput<Infer<TValidator>, TResult, TActions>,
): ChimpbaseActionRegistration<Infer<TValidator>, TResult, TActions>;
export function action<
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
>(
  input: ChimpbaseActionWithoutArgsInput<TResult, TActions>,
): ChimpbaseActionRegistration<[], TResult, TActions>;
export function action<TArgs = unknown[], TResult = unknown, TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry>(
  inputOrName: string | ChimpbaseActionDefinitionInput<any, TResult, TActions> | ChimpbaseActionWithoutArgsInput<TResult, TActions>,
  handler?: ChimpbaseTupleActionHandler<any[], TResult, TActions>,
  options?: ChimpbaseActionOptions,
): ChimpbaseActionRegistration<TArgs, TResult, TActions> {
  if (inputOrName === undefined || inputOrName === null) {
    throw new Error("action requires either a string name or a definition object");
  }

  if (typeof inputOrName !== "string") {
    const definition = inputOrName;
    return createActionRegistration({
      args: "args" in definition ? definition.args : undefined,
      handler: definition.handler as ChimpbaseActionHandler<TArgs, TResult, TActions>,
      kind: "action",
      name: definition.name ?? "",
      telemetry: definition.telemetry,
    });
  }

  if (isChimpbaseActionRegistration(handler)) {
    return createActionRegistration({
      args: handler.args,
      handler: handler.handler as ChimpbaseActionHandler<TArgs, TResult, TActions>,
      kind: "action",
      name: inputOrName,
      telemetry: options?.telemetry ?? handler.telemetry,
    });
  }

  return createActionRegistration({
    handler: handler as ChimpbaseActionHandler<TArgs, TResult, TActions>,
    kind: "action",
    name: inputOrName,
    telemetry: options?.telemetry,
  });
}

export function subscription<TPayload = unknown, TResult = unknown>(
  eventName: string,
  handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
  options?: ChimpbaseSubscriptionOptions,
): ChimpbaseSubscriptionRegistration<TPayload, TResult> {
  return {
    eventName,
    handler,
    idempotent: options?.idempotent,
    kind: "subscription",
    name: options?.name,
    telemetry: options?.telemetry,
  } as ChimpbaseSubscriptionRegistration<TPayload, TResult>;
}

export function worker<TPayload = unknown, TResult = unknown>(
  name: string,
  handler: ChimpbaseWorkerHandler<TPayload, TResult>,
  definition?: ChimpbaseWorkerDefinition,
  options?: { telemetry?: ChimpbaseTelemetryPersistOption },
): ChimpbaseWorkerRegistration<TPayload, TResult> {
  return {
    definition,
    handler,
    kind: "worker",
    name,
    telemetry: options?.telemetry,
  };
}

export function cron<TResult = unknown>(
  name: string,
  schedule: string,
  handler: ChimpbaseCronHandler<TResult>,
  options?: { telemetry?: ChimpbaseTelemetryPersistOption },
): ChimpbaseCronRegistration<TResult> {
  return {
    handler,
    kind: "cron",
    name,
    schedule,
    telemetry: options?.telemetry,
  };
}

export function workflow<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDefinition<TInput, TState>,
): ChimpbaseWorkflowRegistration<TInput, TState> {
  return {
    definition,
    kind: "workflow",
  };
}

export function workflowActionStep<TInput = unknown, TState = unknown, TResult = unknown>(
  id: string,
  actionName: string,
  options?: Omit<ChimpbaseWorkflowActionStepDefinition<TInput, TState, unknown[], TResult>, "action" | "id" | "kind">,
): ChimpbaseWorkflowActionStepDefinition<TInput, TState, unknown[], TResult>;
export function workflowActionStep<
  TInput = unknown,
  TState = unknown,
  TAction extends ChimpbaseActionRegistration<any, any, any> = ChimpbaseActionRegistration<any, any, any>,
>(
  id: string,
  actionReference: TAction,
  options?: Omit<
    ChimpbaseWorkflowActionStepDefinition<
      TInput,
      TState,
      ChimpbaseInferActionArgs<TAction>,
      ChimpbaseInferActionResult<TAction>
    >,
    "action" | "id" | "kind"
  >,
): ChimpbaseWorkflowActionStepDefinition<
  TInput,
  TState,
  ChimpbaseInferActionArgs<TAction>,
  ChimpbaseInferActionResult<TAction>
>;
export function workflowActionStep<TInput = unknown, TState = unknown, TArgs = unknown[], TResult = unknown>(
  id: string,
  actionNameOrReference: string | ChimpbaseActionRegistration<TArgs, TResult, any>,
  options: Omit<ChimpbaseWorkflowActionStepDefinition<TInput, TState, TArgs, TResult>, "action" | "id" | "kind"> = {},
): ChimpbaseWorkflowActionStepDefinition<TInput, TState, TArgs, TResult> {
  return {
    action: actionNameOrReference,
    ...options,
    id,
    kind: "workflow_action",
  };
}

export function workflowSleepStep<TInput = unknown, TState = unknown>(
  id: string,
  delayMs: ChimpbaseWorkflowSleepStepDefinition<TInput, TState>["delayMs"],
): ChimpbaseWorkflowSleepStepDefinition<TInput, TState> {
  return {
    delayMs,
    id,
    kind: "workflow_sleep",
  };
}

export function workflowWaitForSignalStep<TInput = unknown, TState = unknown, TPayload = unknown>(
  id: string,
  signal: string,
  options: Omit<ChimpbaseWorkflowWaitForSignalStepDefinition<TInput, TState, TPayload>, "id" | "kind" | "signal"> = {},
): ChimpbaseWorkflowWaitForSignalStepDefinition<TInput, TState, TPayload> {
  return {
    ...options,
    id,
    kind: "workflow_wait_for_signal",
    signal,
  };
}

export function describeWorkflow<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDefinition<TInput, TState>,
): ChimpbaseWorkflowContract {
  const steps = describeWorkflowSteps(definition);
  const mode = hasWorkflowSteps(definition) ? "steps" : "run";

  return {
    hash: computeWorkflowContractHash({
      inputSchema: definition.inputSchema,
      mode,
      name: definition.name,
      signalSchemas: definition.signalSchemas,
      stateSchema: definition.stateSchema,
      steps,
    }),
    inputSchema: definition.inputSchema,
    mode,
    name: definition.name,
    signalSchemas: definition.signalSchemas,
    stateSchema: definition.stateSchema,
    steps,
    version: definition.version,
  };
}

export function versionWorkflow<TInput = unknown, TState = unknown>(
  draft: ChimpbaseWorkflowDraftDefinition<TInput, TState>,
  previous?: ChimpbaseWorkflowContract | null,
): ChimpbaseVersionedWorkflow<TInput, TState> {
  const nextContract = buildWorkflowContractDraft(draft);

  if (!previous) {
    const contract = {
      ...nextContract,
      version: 1,
    };

    return {
      changed: true,
      compatibility: "additive",
      contract,
      definition: {
        ...draft,
        version: 1,
      },
    };
  }

  if (previous.name !== draft.name) {
    throw new Error(`workflow contract name mismatch: expected ${previous.name}, received ${draft.name}`);
  }

  if (previous.hash === nextContract.hash) {
    return {
      changed: false,
      compatibility: "identical",
      contract: {
        ...nextContract,
        version: previous.version,
      },
      definition: {
        ...draft,
        version: previous.version,
      },
    };
  }

  const compatibility = compareWorkflowContracts(previous, nextContract);
  const version = previous.version + 1;

  return {
    changed: true,
    compatibility,
    contract: {
      ...nextContract,
      version,
    },
    definition: {
      ...draft,
      version,
    },
  };
}

export function compareWorkflowContracts(
  previous: ChimpbaseWorkflowContract,
  next: Omit<ChimpbaseWorkflowContract, "version"> | ChimpbaseWorkflowContract,
): ChimpbaseWorkflowCompatibility {
  let compatibility: ChimpbaseWorkflowCompatibility = "identical";

  if (previous.name !== next.name) {
    return "breaking";
  }

  if (previous.mode !== next.mode) {
    return "breaking";
  }

  compatibility = mergeWorkflowCompatibility(
    compatibility,
    compareWorkflowSteps(previous.steps, next.steps),
  );

  compatibility = mergeWorkflowCompatibility(
    compatibility,
    compareRecordSchemas(previous.signalSchemas ?? {}, next.signalSchemas ?? {}),
  );

  compatibility = mergeWorkflowCompatibility(
    compatibility,
    compareSchemaShape(previous.inputSchema, next.inputSchema),
  );

  compatibility = mergeWorkflowCompatibility(
    compatibility,
    compareSchemaShape(previous.stateSchema, next.stateSchema),
  );

  return compatibility;
}

function flattenChimpbaseEntries(
  entriesOrGroups: ReadonlyArray<ChimpbaseRegistration | readonly ChimpbaseRegistration[]>,
): readonly ChimpbaseAnyRegistration[] {
  return entriesOrGroups.flatMap((entryOrGroup) => Array.isArray(entryOrGroup) ? entryOrGroup : [entryOrGroup]) as readonly ChimpbaseAnyRegistration[];
}

export function register(
  target: ChimpbaseRegistrationTarget,
  ...entriesOrGroups: Array<ChimpbaseRegistration | readonly ChimpbaseRegistration[]>
): void {
  for (const entry of flattenChimpbaseEntries(entriesOrGroups)) {
    switch (entry.kind) {
      case "action": {
        const actionName = resolveActionRegistrationName(entry);
        target.bindActionInvoker?.(entry);
        if (entry.args) {
          target.registerAction(actionName, entry.handler, { args: entry.args });
        } else {
          target.registerAction(actionName, entry.handler);
        }
        if (entry.telemetry !== undefined) {
          target.setTelemetryOverride?.(`action:${actionName}`, entry.telemetry);
        }
        break;
      }
      case "cron":
        if (typeof target.registerCron !== "function") {
          throw new Error(`registration target does not support cron entries: ${entry.name}`);
        }

        target.registerCron(entry.name, entry.schedule, entry.handler);
        if (entry.telemetry !== undefined) {
          target.setTelemetryOverride?.(`cron:${entry.name}`, entry.telemetry);
        }
        break;
      case "subscription":
        target.registerSubscription(
          entry.eventName,
          entry.handler,
          entry.idempotent
            ? { idempotent: true, name: entry.name }
            : { idempotent: entry.idempotent, name: entry.name },
        );
        if (entry.telemetry !== undefined) {
          target.setTelemetryOverride?.(`subscription:${entry.eventName}`, entry.telemetry);
        }
        break;
      case "worker":
        target.registerWorker(entry.name, entry.handler, entry.definition);
        if (entry.telemetry !== undefined) {
          target.setTelemetryOverride?.(`queue:${entry.name}`, entry.telemetry);
        }
        break;
      case "workflow":
        target.registerWorkflow(entry.definition);
        break;
    }
  }
}

export function registerFrom(
  target: ChimpbaseRegistrationTarget,
  ...sources: ChimpbaseDecoratedOwner[]
): void {
  for (const source of sources) {
    register(target, collectDecoratedEntries(source));
  }
}

export function registrationsFrom(
  ...sources: ChimpbaseDecoratedOwner[]
): ChimpbaseRegistration[] {
  return sources.flatMap((source) => collectDecoratedEntries(source));
}

/**
 * @deprecated Use register(target, ...entries) instead.
 */
export function registerChimpbaseEntries(
  target: ChimpbaseRegistrationTarget,
  entries: readonly ChimpbaseRegistration[],
): void {
  register(target, entries);
}

/**
 * @deprecated Use registerFrom(target, ...sources) instead.
 */
export function registerDecoratedEntries(
  target: ChimpbaseRegistrationTarget,
  ...sources: ChimpbaseDecoratedOwner[]
): void {
  registerFrom(target, ...sources);
}

export function Action(name: string) {
  return function (...args: unknown[]): void {
    registerDecoratedMethod(
      "Action",
      args,
      (boundValue) => action(name, boundValue as ChimpbaseActionHandler<any[], any>),
    );
  };
}

export function Subscription(eventName: string) {
  return function (...args: unknown[]): void {
    registerDecoratedMethod(
      "Subscription",
      args,
      (boundValue) => subscription(eventName, boundValue as ChimpbaseSubscriptionHandler<any, any>),
    );
  };
}

export function Worker(name: string, definition?: ChimpbaseWorkerDefinition) {
  return function (...args: unknown[]): void {
    registerDecoratedMethod(
      "Worker",
      args,
      (boundValue) => worker(name, boundValue as ChimpbaseWorkerHandler<any, any>, definition),
    );
  };
}

export function Cron(name: string, schedule: string) {
  return function (...args: unknown[]): void {
    registerDecoratedMethod(
      "Cron",
      args,
      (boundValue) => cron(name, schedule, boundValue as ChimpbaseCronHandler<any>),
    );
  };
}

export function defineAction<TArgs = unknown[], TResult = unknown>(
  name: string,
  handler: ChimpbaseTupleActionHandler<any[], TResult>,
): ChimpbaseTupleActionHandler<any[], TResult>;
export function defineAction<
  TValidator extends ChimpbaseValidator<any>,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
>(
  input: ChimpbaseActionDefinitionInput<Infer<TValidator>, TResult, TActions>,
): ChimpbaseActionRegistration<Infer<TValidator>, TResult, TActions>;
export function defineAction<
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
>(
  input: ChimpbaseActionWithoutArgsInput<TResult, TActions>,
): ChimpbaseActionRegistration<[], TResult, TActions>;
export function defineAction<TArgs = unknown[], TResult = unknown>(
  inputOrName:
    | string
    | ChimpbaseActionDefinitionInput<any, TResult, any>
    | ChimpbaseActionWithoutArgsInput<TResult, any>,
  handler?: ChimpbaseTupleActionHandler<any[], TResult>,
): ChimpbaseTupleActionHandler<any[], TResult> | ChimpbaseActionRegistration<any, TResult, any> {
  if (typeof inputOrName !== "string") {
    return action(inputOrName as ChimpbaseActionDefinitionInput<any, TResult, any>);
  }

  const runtimeDefineAction = (globalThis as RuntimeGlobals).defineAction;
  if (typeof runtimeDefineAction === "function") {
    return runtimeDefineAction(inputOrName, handler as ChimpbaseTupleActionHandler<any[], TResult>);
  }

  return handler as ChimpbaseTupleActionHandler<any[], TResult>;
}

export function defineSubscription<TPayload = unknown, TResult = unknown>(
  eventName: string,
  handler: ChimpbaseSubscriptionHandler<TPayload, TResult>,
): ChimpbaseSubscriptionHandler<TPayload, TResult> {
  const runtimeDefineSubscription = (globalThis as RuntimeGlobals).defineSubscription;
  if (typeof runtimeDefineSubscription === "function") {
    return runtimeDefineSubscription(eventName, handler);
  }

  return handler;
}

export function defineWorker<TPayload = unknown, TResult = unknown>(
  name: string,
  handler: ChimpbaseWorkerHandler<TPayload, TResult>,
  definition?: ChimpbaseWorkerDefinition,
): ChimpbaseWorkerHandler<TPayload, TResult> {
  const runtimeDefineWorker = (globalThis as RuntimeGlobals).defineWorker;
  if (typeof runtimeDefineWorker === "function") {
    return runtimeDefineWorker(name, handler, definition);
  }

  return handler;
}

export function defineCron<TResult = unknown>(
  name: string,
  schedule: string,
  handler: ChimpbaseCronHandler<TResult>,
): ChimpbaseCronHandler<TResult> {
  const runtimeDefineCron = (globalThis as RuntimeGlobals).defineCron;
  if (typeof runtimeDefineCron === "function") {
    return runtimeDefineCron(name, schedule, handler);
  }

  return handler;
}

export function defineWorkflow<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDefinition<TInput, TState>,
): ChimpbaseWorkflowDefinition<TInput, TState> {
  const runtimeDefineWorkflow = (globalThis as RuntimeGlobals).defineWorkflow;
  if (typeof runtimeDefineWorkflow === "function") {
    return runtimeDefineWorkflow(definition);
  }

  return definition;
}

type ChimpbaseValidatorShape = Record<string, ChimpbaseValidator<any>>;
type ChimpbaseOptionalValidatorKeys<TShape extends ChimpbaseValidatorShape> = Extract<{
  [TKey in keyof TShape]: TShape[TKey]["isOptional"] extends true ? TKey : never;
}[keyof TShape], string>;
type ChimpbaseRequiredValidatorKeys<TShape extends ChimpbaseValidatorShape> = Exclude<
  Extract<keyof TShape, string>,
  ChimpbaseOptionalValidatorKeys<TShape>
>;
type ChimpbaseObjectValidatorResult<TShape extends ChimpbaseValidatorShape> = ChimpbaseSimplify<
  { [TKey in ChimpbaseRequiredValidatorKeys<TShape>]: Infer<TShape[TKey]> } &
  { [TKey in ChimpbaseOptionalValidatorKeys<TShape>]?: Infer<TShape[TKey]> }
>;

interface ChimpbaseValidatorFactoryOptions<TValue> {
  isOptional?: true;
  parser: (value: unknown, path: string) => TValue;
  schema: unknown;
}

function createValidator<TValue>(
  options: ChimpbaseValidatorFactoryOptions<TValue>,
): ChimpbaseValidator<TValue> {
  const validator: ChimpbaseValidator<TValue> = {
    ...(options.isOptional ? { isOptional: true as const } : {}),
    schema: options.schema,
    array() {
      return createValidator<TValue[]>({
        parser(value, path) {
          if (!Array.isArray(value)) {
            throw new Error(`${path} must be an array`);
          }

          return value.map((entry, index) => validator.parse(entry, `${path}[${index}]`));
        },
        schema: {
          items: validator.schema,
          type: "array",
        },
      });
    },
    nullable() {
      return createValidator<TValue | null>({
        parser(value, path) {
          if (value === null) {
            return null;
          }

          return validator.parse(value, path);
        },
        schema: {
          anyOf: [validator.schema, { type: "null" }],
        },
      });
    },
    optional() {
      return createValidator<TValue | undefined>({
        isOptional: true,
        parser(value, path) {
          if (value === undefined) {
            return undefined;
          }

          return validator.parse(value, path);
        },
        schema: validator.schema,
      });
    },
    parse(value, path = "value") {
      return options.parser(value, path);
    },
  };

  return validator;
}

function createObjectValidator<TShape extends ChimpbaseValidatorShape>(
  shape: TShape,
): ChimpbaseValidator<ChimpbaseObjectValidatorResult<TShape>> {
  const properties = Object.fromEntries(
    Object.entries(shape).map(([key, validator]) => [key, validator.schema]),
  );
  const required = Object.entries(shape)
    .filter(([, validator]) => validator.isOptional !== true)
    .map(([key]) => key);

  return createValidator<ChimpbaseObjectValidatorResult<TShape>>({
    parser(value, path) {
      if (!isPlainObject(value)) {
        throw new Error(`${path} must be an object`);
      }

      const output: Record<string, unknown> = {};
      for (const [key, validator] of Object.entries(shape)) {
        const hasKey = Object.prototype.hasOwnProperty.call(value, key);
        if (!hasKey) {
          if (validator.isOptional === true) {
            continue;
          }

          throw new Error(`${path}.${key} is required`);
        }

        const parsed = validator.parse((value as Record<string, unknown>)[key], `${path}.${key}`);
        if (parsed !== undefined || hasKey) {
          output[key] = parsed;
        }
      }

      return output as ChimpbaseObjectValidatorResult<TShape>;
    },
    schema: {
      properties,
      required,
      type: "object",
    },
  });
}

function createUnionValidator<TValidators extends readonly ChimpbaseValidator<any>[]>(
  validators: TValidators,
): ChimpbaseValidator<Infer<TValidators[number]>> {
  return createValidator<Infer<TValidators[number]>>({
    parser(value, path) {
      const messages: string[] = [];
      for (const validator of validators) {
        try {
          return validator.parse(value, path) as Infer<TValidators[number]>;
        } catch (error) {
          messages.push(error instanceof Error ? error.message : String(error));
        }
      }

      throw new Error(messages[0] ?? `${path} did not match any allowed shape`);
    },
    schema: {
      anyOf: validators.map((validator) => validator.schema),
    },
  });
}

export const v = {
  any(): ChimpbaseValidator<unknown> {
    return this.unknown();
  },
  array<TValue>(validator: ChimpbaseValidator<TValue>): ChimpbaseValidator<TValue[]> {
    return validator.array();
  },
  boolean(): ChimpbaseValidator<boolean> {
    return createValidator<boolean>({
      parser(value, path) {
        if (typeof value !== "boolean") {
          throw new Error(`${path} must be a boolean`);
        }

        return value;
      },
      schema: { type: "boolean" },
    });
  },
  enum<TValues extends readonly [string, ...string[]]>(
    values: TValues,
  ): ChimpbaseValidator<TValues[number]> {
    return createValidator<TValues[number]>({
      parser(value, path) {
        if (typeof value !== "string" || !values.includes(value as TValues[number])) {
          throw new Error(`${path} must be one of ${values.join(", ")}`);
        }

        return value as TValues[number];
      },
      schema: { enum: [...values] },
    });
  },
  literal<TValue extends string | number | boolean | null>(
    expected: TValue,
  ): ChimpbaseValidator<TValue> {
    return createValidator<TValue>({
      parser(value, path) {
        if (value !== expected) {
          throw new Error(`${path} must be ${JSON.stringify(expected)}`);
        }

        return expected;
      },
      schema: { const: expected },
    });
  },
  null(): ChimpbaseValidator<null> {
    return createValidator<null>({
      parser(value, path) {
        if (value !== null) {
          throw new Error(`${path} must be null`);
        }

        return null;
      },
      schema: { type: "null" },
    });
  },
  number(): ChimpbaseValidator<number> {
    return createValidator<number>({
      parser(value, path) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`${path} must be a finite number`);
        }

        return value;
      },
      schema: { type: "number" },
    });
  },
  object<TShape extends ChimpbaseValidatorShape>(
    shape: TShape,
  ): ChimpbaseValidator<ChimpbaseObjectValidatorResult<TShape>> {
    return createObjectValidator(shape);
  },
  optional<TValue>(validator: ChimpbaseValidator<TValue>): ChimpbaseValidator<TValue | undefined> {
    return validator.optional();
  },
  string(): ChimpbaseValidator<string> {
    return createValidator<string>({
      parser(value, path) {
        if (typeof value !== "string") {
          throw new Error(`${path} must be a string`);
        }

        return value;
      },
      schema: { type: "string" },
    });
  },
  union<TValidators extends readonly [ChimpbaseValidator<any>, ...ChimpbaseValidator<any>[]]>(
    ...validators: TValidators
  ): ChimpbaseValidator<Infer<TValidators[number]>> {
    return createUnionValidator(validators);
  },
  unknown(): ChimpbaseValidator<unknown> {
    return createValidator<unknown>({
      parser(value) {
        return value;
      },
      schema: {},
    });
  },
};

export function isChimpbaseActionRegistration(value: unknown): value is ChimpbaseActionRegistration<any, any, any> {
  return Boolean(
    value
      && (typeof value === "object" || typeof value === "function")
      && (value as { kind?: unknown }).kind === "action"
      && typeof (value as { name?: unknown }).name === "string"
      && "handler" in (value as object),
  );
}

export function hasChimpbaseActionRegistrationName(
  value: ChimpbaseActionRegistration<any, any, any>,
): boolean {
  return value.name.length > 0;
}

export function setChimpbaseActionRegistrationName(
  value: ChimpbaseActionRegistration<any, any, any>,
  name: string,
): void {
  if (!name) {
    throw new Error("action registration name cannot be empty");
  }

  defineRegistrationProperty(value, "name", name);
}

export function resolveChimpbaseActionRegistrationName(
  value: ChimpbaseActionRegistration<any, any, any>,
): string {
  return resolveActionRegistrationName(value);
}

function getActionInvokerStorage(): AsyncLocalStorage<ChimpbaseActionInvoker> {
  const runtimeGlobals = globalThis as typeof globalThis & {
    [ACTION_INVOKER_STORAGE_KEY]?: AsyncLocalStorage<ChimpbaseActionInvoker>;
  };

  if (!runtimeGlobals[ACTION_INVOKER_STORAGE_KEY]) {
    runtimeGlobals[ACTION_INVOKER_STORAGE_KEY] = new AsyncLocalStorage<ChimpbaseActionInvoker>();
  }

  return runtimeGlobals[ACTION_INVOKER_STORAGE_KEY];
}

function getBoundActionInvokers(): WeakMap<ChimpbaseActionRegistration<any, any, any>, ChimpbaseActionInvoker> {
  const runtimeGlobals = globalThis as typeof globalThis & {
    [ACTION_REFERENCE_INVOKERS_KEY]?: WeakMap<ChimpbaseActionRegistration<any, any, any>, ChimpbaseActionInvoker>;
  };

  if (!runtimeGlobals[ACTION_REFERENCE_INVOKERS_KEY]) {
    runtimeGlobals[ACTION_REFERENCE_INVOKERS_KEY] = new WeakMap();
  }

  return runtimeGlobals[ACTION_REFERENCE_INVOKERS_KEY];
}

function createActionRegistration<
  TArgs = unknown[],
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
>(
  registration: {
    args?: ChimpbaseValidator<TArgs>;
    handler: ChimpbaseActionHandler<TArgs, TResult, TActions>;
    kind: "action";
    name?: string;
    telemetry?: ChimpbaseTelemetryPersistOption;
  },
): ChimpbaseActionRegistration<TArgs, TResult, TActions> {
  const callable = (async (...args: ChimpbaseActionCallArgs<TArgs>): Promise<TResult> => {
    const invoker = actionInvokerStorage.getStore() ?? getBoundActionInvokers().get(callable);
    if (!invoker) {
      const actionName = formatActionRegistrationName(registration.name);
      throw new Error(
        `action ${actionName} requires an active chimpbase runtime context or a registered host binding; use ctx.action(${actionName}, ...) or host.executeAction(${actionName}, ...)`,
      );
    }

    return await invoker<TResult>(callable, args as unknown[]);
  }) as ChimpbaseActionRegistration<TArgs, TResult, TActions>;

  defineRegistrationProperty(callable, "kind", registration.kind);
  defineRegistrationProperty(callable, "name", registration.name ?? "");
  defineRegistrationProperty(callable, "handler", registration.handler);

  if (registration.args !== undefined) {
    defineRegistrationProperty(callable, "args", registration.args);
  }

  if (registration.telemetry !== undefined) {
    defineRegistrationProperty(callable, "telemetry", registration.telemetry);
  }

  return callable;
}

function resolveActionRegistrationName(
  registration: ChimpbaseActionRegistration<any, any, any>,
): string {
  if (registration.name.length > 0) {
    return registration.name;
  }

  throw new Error(
    "unnamed action registration cannot be registered or referenced yet; add a name explicitly or export it from chimpbase.app.ts so the loader can infer module path + export name",
  );
}

function formatActionRegistrationName(name: string | undefined): string {
  return name && name.length > 0 ? name : "<unnamed action>";
}

function defineRegistrationProperty<TTarget extends object, TKey extends keyof any>(
  target: TTarget,
  key: TKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: false,
  });
}

function registerDecoratedMethod(
  decoratorName: "Action" | "Cron" | "Subscription" | "Worker",
  args: unknown[],
  createEntry: (boundValue: ChimpbaseDecoratorMethod) => ChimpbaseAnyRegistration,
): void {
  if (isStandardMethodDecoratorArgs(args)) {
    const [value, context] = args;
    if (context.kind !== "method") {
      throw new Error(`@${decoratorName} only supports methods`);
    }

    context.addInitializer(function () {
      const owner = this as ChimpbaseDecoratedOwner;
      const entries = decoratedEntryStore.get(owner) ?? [];
      entries.push(createEntry(value.bind(owner)));
      decoratedEntryStore.set(owner, entries);
    });
    return;
  }

  if (isLegacyMethodDecoratorArgs(args)) {
    const [target, propertyKey, descriptor] = args;
    const method = descriptor?.value;
    if (typeof method !== "function") {
      throw new Error(`@${decoratorName} only supports methods`);
    }

    const entries = legacyDecoratedEntryStore.get(target) ?? [];
    entries.push({
      createEntry(owner) {
        const member = (owner as Record<PropertyKey, unknown>)[propertyKey];
        const boundMethod =
          typeof member === "function" ? member.bind(owner) : method.bind(owner);
        return createEntry(boundMethod);
      },
    });
    legacyDecoratedEntryStore.set(target, entries);
    return;
  }

  throw new Error(`@${decoratorName} received an unsupported decorator signature`);
}

function collectDecoratedEntries(source: ChimpbaseDecoratedOwner): ChimpbaseAnyRegistration[] {
  if (typeof source === "function") {
    return [
      ...(decoratedEntryStore.get(source) ?? []),
      ...collectLegacyDecoratedEntries(source, source),
    ];
  }

  const entries = [
    ...(decoratedEntryStore.get(source) ?? []),
    ...collectLegacyDecoratedEntries(getPrototypeOwner(source), source),
  ];
  const constructorEntries = getDecoratedConstructorEntries(source);

  if (constructorEntries.length === 0) {
    return entries;
  }

  return [...constructorEntries, ...entries];
}

function buildWorkflowContractDraft<TInput = unknown, TState = unknown>(
  draft: ChimpbaseWorkflowDraftDefinition<TInput, TState>,
): Omit<ChimpbaseWorkflowContract, "version"> {
  const steps = describeWorkflowSteps(draft);
  const mode = hasWorkflowSteps(draft) ? "steps" : "run";

  return {
    hash: computeWorkflowContractHash({
      inputSchema: draft.inputSchema,
      mode,
      name: draft.name,
      signalSchemas: draft.signalSchemas,
      stateSchema: draft.stateSchema,
      steps,
    }),
    inputSchema: draft.inputSchema,
    mode,
    name: draft.name,
    signalSchemas: draft.signalSchemas,
    stateSchema: draft.stateSchema,
    steps,
  };
}

function describeWorkflowSteps<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDraftDefinition<TInput, TState> | ChimpbaseWorkflowDefinition<TInput, TState>,
): ChimpbaseWorkflowRegisteredStep[] {
  if (!hasWorkflowSteps(definition)) {
    return [];
  }

  return definition.steps.map((step) => {
    switch (step.kind) {
      case "workflow_action":
        return {
          action: typeof step.action === "string" ? step.action : resolveActionRegistrationName(step.action),
          id: step.id,
          kind: step.kind,
        };
      case "workflow_wait_for_signal":
        return {
          id: step.id,
          kind: step.kind,
          signal: step.signal,
        };
      default:
        return {
          id: step.id,
          kind: step.kind,
        };
    }
  });
}

function computeWorkflowContractHash(contract: Omit<ChimpbaseWorkflowContract, "hash" | "version">): string {
  return hashDeterministicString(stableSerialize(contract));
}

function compareWorkflowSteps(
  previous: readonly ChimpbaseWorkflowRegisteredStep[],
  next: readonly ChimpbaseWorkflowRegisteredStep[],
): ChimpbaseWorkflowCompatibility {
  const previousIds = previous.map((step) => step.id);
  const nextIds = next.map((step) => step.id);
  const nextIdSet = new Set(nextIds);

  for (const step of previous) {
    if (!nextIdSet.has(step.id)) {
      return "breaking";
    }

    const nextStep = next.find((candidate) => candidate.id === step.id);
    if (!nextStep || nextStep.kind !== step.kind || nextStep.action !== step.action || nextStep.signal !== step.signal) {
      return "breaking";
    }
  }

  let insertedBeforeExisting = false;
  let previousIndex = 0;

  for (const nextId of nextIds) {
    const expectedId = previousIds[previousIndex];
    if (expectedId === nextId) {
      previousIndex += 1;
      continue;
    }

    if (previousIds.includes(nextId)) {
      return "breaking";
    }

    if (previousIndex < previousIds.length) {
      insertedBeforeExisting = true;
    }
  }

  if (previousIndex !== previousIds.length) {
    return "breaking";
  }

  if (insertedBeforeExisting) {
    return "requires_migration";
  }

  return nextIds.length === previousIds.length ? "identical" : "additive";
}

function compareRecordSchemas(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): ChimpbaseWorkflowCompatibility {
  let compatibility: ChimpbaseWorkflowCompatibility = "identical";

  for (const [key, previousSchema] of Object.entries(previous)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      return "breaking";
    }

    compatibility = mergeWorkflowCompatibility(
      compatibility,
      compareSchemaShape(previousSchema, next[key]),
    );
  }

  for (const key of Object.keys(next)) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) {
      compatibility = mergeWorkflowCompatibility(compatibility, "additive");
    }
  }

  return compatibility;
}

function compareSchemaShape(previous: unknown, next: unknown): ChimpbaseWorkflowCompatibility {
  if (previous === undefined && next === undefined) {
    return "identical";
  }

  if (previous === undefined || next === undefined) {
    return "breaking";
  }

  if (stableSerialize(previous) === stableSerialize(next)) {
    return "identical";
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    let compatibility: ChimpbaseWorkflowCompatibility = "identical";

    const previousType = previous.type;
    const nextType = next.type;
    if (previousType !== undefined || nextType !== undefined) {
      if (stableSerialize(previousType) !== stableSerialize(nextType)) {
        return "breaking";
      }
    }

    if (Array.isArray(previous.enum) || Array.isArray(next.enum)) {
      const previousEnum = Array.isArray(previous.enum) ? previous.enum : [];
      const nextEnum = Array.isArray(next.enum) ? next.enum : [];
      if (previousEnum.some((entry) => !nextEnum.some((candidate) => stableSerialize(candidate) === stableSerialize(entry)))) {
        return "breaking";
      }

      if (nextEnum.length > previousEnum.length) {
        compatibility = mergeWorkflowCompatibility(compatibility, "additive");
      }
    }

    if ((previous.type === "object" || previous.properties || previous.required)
      && (next.type === "object" || next.properties || next.required)) {
      const previousProperties = isPlainObject(previous.properties) ? previous.properties : {};
      const nextProperties = isPlainObject(next.properties) ? next.properties : {};
      const previousRequired = new Set(Array.isArray(previous.required) ? previous.required : []);
      const nextRequired = new Set(Array.isArray(next.required) ? next.required : []);

      for (const key of Object.keys(previousProperties)) {
        if (!Object.prototype.hasOwnProperty.call(nextProperties, key)) {
          return "breaking";
        }

        compatibility = mergeWorkflowCompatibility(
          compatibility,
          compareSchemaShape(previousProperties[key], nextProperties[key]),
        );

        if (previousRequired.has(key) && !nextRequired.has(key)) {
          compatibility = mergeWorkflowCompatibility(compatibility, "additive");
        }
      }

      for (const key of Object.keys(nextProperties)) {
        if (!Object.prototype.hasOwnProperty.call(previousProperties, key)) {
          compatibility = mergeWorkflowCompatibility(
            compatibility,
            nextRequired.has(key) ? "breaking" : "additive",
          );
        } else if (!previousRequired.has(key) && nextRequired.has(key)) {
          return "breaking";
        }
      }

      return compatibility;
    }

    if ((previous.type === "array" || previous.items !== undefined)
      && (next.type === "array" || next.items !== undefined)) {
      return compareSchemaShape(previous.items, next.items);
    }
  }

  return "breaking";
}

function mergeWorkflowCompatibility(
  current: ChimpbaseWorkflowCompatibility,
  next: ChimpbaseWorkflowCompatibility,
): ChimpbaseWorkflowCompatibility {
  const rank: Record<ChimpbaseWorkflowCompatibility, number> = {
    identical: 0,
    additive: 1,
    requires_migration: 2,
    breaking: 3,
  };

  return rank[next] > rank[current] ? next : current;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortSerializableValue(value));
}

const DETERMINISTIC_HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const DETERMINISTIC_HASH_PRIME = 0x100000001b3n;
const textEncoder = new TextEncoder();

function hashDeterministicString(input: string): string {
  let hash = DETERMINISTIC_HASH_OFFSET_BASIS;

  for (const byte of textEncoder.encode(input)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * DETERMINISTIC_HASH_PRIME);
  }

  return hash.toString(16).padStart(16, "0");
}

function sortSerializableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortSerializableValue(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortSerializableValue(entry)]),
  );
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasWorkflowSteps<TInput = unknown, TState = unknown>(
  definition: ChimpbaseWorkflowDraftDefinition<TInput, TState> | ChimpbaseWorkflowDefinition<TInput, TState>,
): definition is ChimpbaseWorkflowStepsDraftDefinition<TInput, TState> | (ChimpbaseWorkflowDefinition<TInput, TState> & ChimpbaseWorkflowStepsDraftDefinition<TInput, TState>) {
  return Array.isArray((definition as { steps?: unknown }).steps);
}

function getDecoratedConstructorEntries(source: ChimpbaseDecoratedOwner): ChimpbaseAnyRegistration[] {
  if (typeof source !== "object" || source === null || !("constructor" in source)) {
    return [];
  }

  const constructor = source.constructor;
  if (typeof constructor !== "function") {
    return [];
  }

  return [
    ...(decoratedEntryStore.get(constructor) ?? []),
    ...collectLegacyDecoratedEntries(constructor, source),
  ];
}

function collectLegacyDecoratedEntries(
  key: ChimpbaseDecoratedOwner | null,
  owner: object,
): ChimpbaseAnyRegistration[] {
  if (!key) {
    return [];
  }

  const entries = legacyDecoratedEntryStore.get(key) ?? [];
  return entries.map((entry) => entry.createEntry(owner));
}

function getPrototypeOwner(source: object): object | null {
  return Object.getPrototypeOf(source);
}

function isStandardMethodDecoratorArgs(
  args: unknown[],
): args is [ChimpbaseDecoratorMethod, ClassMethodDecoratorContext] {
  return (
    args.length === 2 &&
    typeof args[0] === "function" &&
    typeof args[1] === "object" &&
    args[1] !== null &&
    "kind" in args[1]
  );
}

function isLegacyMethodDecoratorArgs(
  args: unknown[],
): args is [Record<PropertyKey, unknown>, string | symbol, TypedPropertyDescriptor<ChimpbaseDecoratorMethod>] {
  return (
    args.length === 3 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    (typeof args[1] === "string" || typeof args[1] === "symbol") &&
    typeof args[2] === "object" &&
    args[2] !== null &&
    "value" in args[2]
  );
}
