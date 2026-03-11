export type ChimpbaseRow = Record<string, unknown>;
export type ChimpbaseQueryResult<T = ChimpbaseRow> = T[];
export type ChimpbaseTelemetryAttributes = Record<string, string | number | boolean | null>;

export interface ChimpbaseActionDefinition<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
> {
  args: TArgs;
  result: TResult;
}

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
type ChimpbaseActionResult<
  TActions extends ChimpbaseActionMap,
  TName extends ChimpbaseKnownActionName<TActions>,
> =
  ChimpbaseRegisteredActions<TActions>[TName] extends ChimpbaseActionDefinition<unknown[], infer TResult>
    ? TResult
    : never;

type ChimpbaseMethodKeys<TValue> = Extract<{
  [TKey in keyof TValue]: TValue[TKey] extends (...args: any[]) => unknown ? TKey : never;
}[keyof TValue], string>;

type ChimpbaseActionDefinitionFromMethod<TValue> =
  TValue extends (ctx: ChimpbaseContext<any>, ...args: infer TArgs) => infer TResult
    ? ChimpbaseActionDefinition<TArgs, Awaited<TResult>>
    : never;

type ChimpbaseActionsFromModule<TModule> = {
  [TKey in ChimpbaseMethodKeys<TModule> as ChimpbaseActionDefinitionFromMethod<TModule[TKey]> extends never
    ? never
    : TKey]: ChimpbaseActionDefinitionFromMethod<TModule[TKey]>;
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
  [TKey in ChimpbaseMethodKeys<TRecord> as ChimpbaseActionDefinitionFromMethod<TRecord[TKey]> extends never
    ? never
    : TKey]: ChimpbaseActionDefinitionFromMethod<TRecord[TKey]>;
}>;

export interface ChimpbaseTraceSpan {
  setAttribute(key: string, value: string | number | boolean | null): void;
}

export interface ChimpbaseQueueSendOptions {
  delayMs?: number;
}

export interface ChimpbaseQueueDefinition {
  dlq?: false | string;
}

export interface ChimpbaseDlqEnvelope<TPayload = unknown> {
  attempts: number;
  error: string;
  failedAt: string;
  payload: TPayload;
  queue: string;
}

export interface ChimpbaseQueueClient {
  send<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: ChimpbaseQueueSendOptions,
  ): Promise<void>;
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
  publish<TPayload = unknown>(stream: string, event: string, payload: TPayload): Promise<number>;
  read<TPayload = unknown>(
    stream: string,
    options?: ChimpbaseStreamReadOptions,
  ): Promise<ChimpbaseStreamEvent<TPayload>[]>;
}

export interface ChimpbaseLogger {
  debug(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
  info(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
  warn(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
  error(message: string, attributes?: ChimpbaseTelemetryAttributes): void;
}

export interface ChimpbaseContext<TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry> {
  query<T = ChimpbaseRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<ChimpbaseQueryResult<T>>;
  emit<TPayload = unknown>(eventName: string, payload: TPayload): void;
  secret(name: string): string | null;
  kv: ChimpbaseKvClient;
  collection: ChimpbaseCollectionClient;
  stream: ChimpbaseStreamClient;
  queue: ChimpbaseQueueClient;
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
  action<TName extends ChimpbaseKnownActionName<TActions>>(
    name: TName,
    ...args: ChimpbaseActionArgs<TActions, TName>
  ): Promise<ChimpbaseActionResult<TActions, TName>>;
  action<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    ...args: TArgs
  ): Promise<TResult>;
}

export interface ChimpbaseRouteEnv<TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry> {
  action<TName extends ChimpbaseKnownActionName<TActions>>(
    name: TName,
    ...args: ChimpbaseActionArgs<TActions, TName>
  ): Promise<ChimpbaseActionResult<TActions, TName>>;
  action<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    ...args: TArgs
  ): Promise<TResult>;
}

export type ChimpbaseActionHandler<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  ...args: TArgs
) => Promise<TResult> | TResult;

type ChimpbaseActionMethod<TThis, TArgs extends unknown[] = unknown[], TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  ...args: TArgs
) => TResult | Promise<TResult>;

export type ChimpbaseListenerHandler<
  TPayload = unknown,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  payload: TPayload,
) => Promise<TResult> | TResult;

type ChimpbaseListenerMethod<TThis, TPayload = unknown, TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  payload: TPayload,
) => TResult | Promise<TResult>;

export type ChimpbaseQueueHandler<
  TPayload = unknown,
  TResult = unknown,
  TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry,
> = (
  ctx: ChimpbaseContext<TActions>,
  payload: TPayload,
) => Promise<TResult> | TResult;

type ChimpbaseQueueMethod<TThis, TPayload = unknown, TResult = unknown> = (
  this: TThis,
  ctx: ChimpbaseContext<any>,
  payload: TPayload,
) => TResult | Promise<TResult>;

export type ChimpbaseRouteHandler<TActions extends ChimpbaseActionMap = ChimpbaseActionRegistry> = (
  request: Request,
  env: ChimpbaseRouteEnv<TActions>,
) => Response | Promise<Response>;

export interface ChimpbaseRegistrationTarget {
  registerAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ): ChimpbaseActionHandler<TArgs, TResult>;
  registerListener<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseListenerHandler<TPayload, TResult>,
  ): ChimpbaseListenerHandler<TPayload, TResult>;
  registerQueue<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseQueueHandler<TPayload, TResult>,
    definition?: ChimpbaseQueueDefinition,
  ): ChimpbaseQueueHandler<TPayload, TResult>;
}

export interface ChimpbaseActionRegistration<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
> {
  kind: "action";
  handler: ChimpbaseActionHandler<TArgs, TResult>;
  name: string;
}

export interface ChimpbaseListenerRegistration<TPayload = unknown, TResult = unknown> {
  eventName: string;
  handler: ChimpbaseListenerHandler<TPayload, TResult>;
  kind: "listener";
}

export interface ChimpbaseQueueRegistration<TPayload = unknown, TResult = unknown> {
  definition?: ChimpbaseQueueDefinition;
  handler: ChimpbaseQueueHandler<TPayload, TResult>;
  kind: "queue";
  name: string;
}

export type ChimpbaseRegistration =
  | ChimpbaseActionRegistration
  | ChimpbaseListenerRegistration
  | ChimpbaseQueueRegistration;

type ChimpbaseAnyRegistration =
  | ChimpbaseActionRegistration<any, any>
  | ChimpbaseListenerRegistration<any, any>
  | ChimpbaseQueueRegistration<any, any>;

type ChimpbaseDecoratedOwner = object;
type ChimpbaseDecoratorMethod = (...args: any[]) => unknown;
interface ChimpbaseLegacyDecoratedEntry {
  createEntry(owner: object): ChimpbaseAnyRegistration;
}

const decoratedEntryStore = new WeakMap<ChimpbaseDecoratedOwner, ChimpbaseAnyRegistration[]>();
const legacyDecoratedEntryStore = new WeakMap<ChimpbaseDecoratedOwner, ChimpbaseLegacyDecoratedEntry[]>();

type RuntimeGlobals = typeof globalThis & {
  defineAction?: <TArgs extends unknown[] = unknown[], TResult = unknown>(
    name: string,
    handler: ChimpbaseActionHandler<TArgs, TResult>,
  ) => ChimpbaseActionHandler<TArgs, TResult>;
  defineListener?: <TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: ChimpbaseListenerHandler<TPayload, TResult>,
  ) => ChimpbaseListenerHandler<TPayload, TResult>;
  defineQueue?: <TPayload = unknown, TResult = unknown>(
    name: string,
    handler: ChimpbaseQueueHandler<TPayload, TResult>,
    definition?: ChimpbaseQueueDefinition,
  ) => ChimpbaseQueueHandler<TPayload, TResult>;
};

export function action<TArgs extends unknown[] = unknown[], TResult = unknown>(
  name: string,
  handler: ChimpbaseActionHandler<TArgs, TResult>,
): ChimpbaseActionRegistration<TArgs, TResult> {
  return {
    handler,
    kind: "action",
    name,
  };
}

export function listener<TPayload = unknown, TResult = unknown>(
  eventName: string,
  handler: ChimpbaseListenerHandler<TPayload, TResult>,
): ChimpbaseListenerRegistration<TPayload, TResult> {
  return {
    eventName,
    handler,
    kind: "listener",
  };
}

export function queue<TPayload = unknown, TResult = unknown>(
  name: string,
  handler: ChimpbaseQueueHandler<TPayload, TResult>,
  definition?: ChimpbaseQueueDefinition,
): ChimpbaseQueueRegistration<TPayload, TResult> {
  return {
    definition,
    handler,
    kind: "queue",
    name,
  };
}

export function registerChimpbaseEntries(
  target: ChimpbaseRegistrationTarget,
  entries: readonly ChimpbaseAnyRegistration[],
): void {
  for (const entry of entries) {
    switch (entry.kind) {
      case "action":
        target.registerAction(entry.name, entry.handler);
        break;
      case "listener":
        target.registerListener(entry.eventName, entry.handler);
        break;
      case "queue":
        target.registerQueue(entry.name, entry.handler, entry.definition);
        break;
    }
  }
}

export function registerDecoratedEntries(
  target: ChimpbaseRegistrationTarget,
  ...sources: ChimpbaseDecoratedOwner[]
): void {
  for (const source of sources) {
    registerChimpbaseEntries(target, collectDecoratedEntries(source));
  }
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

export function Listener(eventName: string) {
  return function (...args: unknown[]): void {
    registerDecoratedMethod(
      "Listener",
      args,
      (boundValue) => listener(eventName, boundValue as ChimpbaseListenerHandler<any, any>),
    );
  };
}

export function Queue(name: string, definition?: ChimpbaseQueueDefinition) {
  return function (...args: unknown[]): void {
    registerDecoratedMethod(
      "Queue",
      args,
      (boundValue) => queue(name, boundValue as ChimpbaseQueueHandler<any, any>, definition),
    );
  };
}

export function defineAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
  name: string,
  handler: ChimpbaseActionHandler<TArgs, TResult>,
): ChimpbaseActionHandler<TArgs, TResult> {
  const runtimeDefineAction = (globalThis as RuntimeGlobals).defineAction;
  if (typeof runtimeDefineAction === "function") {
    return runtimeDefineAction(name, handler);
  }

  return handler;
}

export function defineListener<TPayload = unknown, TResult = unknown>(
  eventName: string,
  handler: ChimpbaseListenerHandler<TPayload, TResult>,
): ChimpbaseListenerHandler<TPayload, TResult> {
  const runtimeDefineListener = (globalThis as RuntimeGlobals).defineListener;
  if (typeof runtimeDefineListener === "function") {
    return runtimeDefineListener(eventName, handler);
  }

  return handler;
}

export function defineQueue<TPayload = unknown, TResult = unknown>(
  name: string,
  handler: ChimpbaseQueueHandler<TPayload, TResult>,
  definition?: ChimpbaseQueueDefinition,
): ChimpbaseQueueHandler<TPayload, TResult> {
  const runtimeDefineQueue = (globalThis as RuntimeGlobals).defineQueue;
  if (typeof runtimeDefineQueue === "function") {
    return runtimeDefineQueue(name, handler, definition);
  }

  return handler;
}

function registerDecoratedMethod(
  decoratorName: "Action" | "Listener" | "Queue",
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
