import type { ChimpbaseContext, ChimpbaseRouteEnv } from "@chimpbase/runtime";

export interface ServiceSelf<TSettings = unknown, TMethods extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>> {
  readonly call: <TResult = unknown>(actionName: string, args?: unknown, options?: CallOptions) => Promise<TResult>;
  readonly emit: <TPayload = unknown>(event: string, payload: TPayload, options?: EmitOptions) => Promise<void>;
  readonly methods: TMethods & Record<string, (...args: any[]) => unknown>;
  readonly name: string;
  readonly nodeId: string;
  readonly settings: TSettings;
  readonly version: number;
}

export type ServiceActionHandler<
  TSettings = unknown,
  TMethods extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>,
  TArgs = unknown,
  TResult = unknown,
> = (
  ctx: ChimpbaseContext,
  args: TArgs,
  self: ServiceSelf<TSettings, TMethods>,
) => Promise<TResult> | TResult;

export type ServiceEventHandler<
  TSettings = unknown,
  TMethods extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>,
  TPayload = unknown,
> = (
  ctx: ChimpbaseContext,
  payload: TPayload,
  self: ServiceSelf<TSettings, TMethods>,
) => Promise<void> | void;

export interface ServiceEventDefinition<
  TSettings = unknown,
  TMethods extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>,
  TPayload = unknown,
> {
  balanced?: boolean;
  handler: ServiceEventHandler<TSettings, TMethods, TPayload>;
}

export interface ServiceDefinition<
  TSettings = unknown,
  TMethods extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>,
> {
  actions?: Record<string, ServiceActionHandler<TSettings, TMethods, any, any>>;
  events?: Record<
    string,
    | ServiceEventHandler<TSettings, TMethods, any>
    | ServiceEventDefinition<TSettings, TMethods, any>
  >;
  methods?: TMethods;
  mixins?: readonly ServiceDefinition<any, any>[];
  name: string;
  settings?: TSettings;
  started?: (ctx: ChimpbaseContext, self: ServiceSelf<TSettings, TMethods>) => Promise<void> | void;
  stopped?: () => Promise<void> | void;
  version?: number;
}

export type LoadBalanceStrategy = "local-first" | "round-robin" | "random" | "cpu";

export interface CallOptions {
  fallback?: (error: Error) => unknown | Promise<unknown>;
  nodeId?: string;
  retry?: { attempts: number; delayMs?: number };
  strategy?: LoadBalanceStrategy;
  timeoutMs?: number;
}

export interface EmitOptions {
  balanced?: boolean;
}

export type MeshCallFn = (
  actionName: string,
  args: unknown,
  options: CallOptions,
) => Promise<unknown>;

export type MeshCallMiddleware = (next: MeshCallFn) => MeshCallFn;

export interface NodeServiceEntry {
  actions: readonly string[];
  events: readonly string[];
  name: string;
  version: number;
}

export interface NodeRecord {
  advertisedUrl: string | null;
  lastHeartbeatMs: number;
  metadata: Record<string, unknown>;
  nodeId: string;
  services: readonly NodeServiceEntry[];
  startedAtMs: number;
}

export interface ChimpbaseMeshClient {
  call<TResult = unknown>(actionName: string, args?: unknown, options?: CallOptions): Promise<TResult>;
  emit<TPayload = unknown>(event: string, payload: TPayload, options?: EmitOptions): Promise<void>;
  nodeId(): string;
  peers(): readonly NodeRecord[];
}

export class MeshActionNotFoundError extends Error {
  readonly actionName: string;
  constructor(actionName: string) {
    super(`mesh action not found: ${actionName}`);
    this.name = "MeshActionNotFoundError";
    this.actionName = actionName;
  }
}

export class MeshNoAvailableNodeError extends Error {
  readonly actionName: string;
  constructor(actionName: string) {
    super(`no mesh node currently serves action: ${actionName}`);
    this.name = "MeshNoAvailableNodeError";
    this.actionName = actionName;
  }
}

export class MeshTimeoutError extends Error {
  readonly actionName: string;
  readonly nodeId: string | null;
  constructor(actionName: string, nodeId: string | null, timeoutMs: number) {
    super(`mesh call timed out after ${timeoutMs}ms: ${actionName}`);
    this.name = "MeshTimeoutError";
    this.actionName = actionName;
    this.nodeId = nodeId;
  }
}

export class MeshCallError extends Error {
  readonly actionName: string;
  readonly nodeId: string | null;
  readonly cause?: unknown;
  constructor(actionName: string, nodeId: string | null, message: string, cause?: unknown) {
    super(message);
    this.name = "MeshCallError";
    this.actionName = actionName;
    this.nodeId = nodeId;
    this.cause = cause;
  }
}

export class MeshConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeshConfigurationError";
  }
}

export type MeshRouteEnv = ChimpbaseRouteEnv & { mesh: ChimpbaseMeshClient };
