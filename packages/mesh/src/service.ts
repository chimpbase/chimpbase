import type {
  ServiceActionHandler,
  ServiceDefinition,
  ServiceEventDefinition,
  ServiceEventHandler,
} from "./types.ts";

export function service<
  TSettings = unknown,
  TMethods extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>,
>(
  def: ServiceDefinition<TSettings, TMethods>,
): ServiceDefinition<TSettings, TMethods> {
  if (!def.name) {
    throw new Error("service definition requires a name");
  }

  return def;
}

export interface ResolvedService {
  actions: Record<string, ServiceActionHandler<any, any, any, any>>;
  events: Record<string, ServiceEventDefinition<any, any, any>>;
  methods: Record<string, unknown>;
  name: string;
  settings: Record<string, unknown>;
  started?: ServiceDefinition["started"];
  stopped?: ServiceDefinition["stopped"];
  version: number;
}

export function resolveService(
  def: ServiceDefinition<any, any>,
  seen: Set<ServiceDefinition<any, any>> = new Set(),
): ResolvedService {
  if (seen.has(def)) {
    throw new Error(`service "${def.name}" has a circular mixin reference`);
  }

  seen.add(def);

  const merged: ResolvedService = {
    actions: {},
    events: {},
    methods: {},
    name: def.name,
    settings: {},
    version: def.version ?? 1,
  };

  for (const mixin of def.mixins ?? []) {
    const resolved = resolveService(mixin, seen);
    Object.assign(merged.actions, resolved.actions);
    Object.assign(merged.events, resolved.events);
    Object.assign(merged.methods, resolved.methods);
    Object.assign(merged.settings, resolved.settings);
  }

  if (def.settings) {
    Object.assign(merged.settings, def.settings as Record<string, unknown>);
  }

  if (def.methods) {
    Object.assign(merged.methods, def.methods as Record<string, unknown>);
  }

  for (const [actionName, handler] of Object.entries(def.actions ?? {})) {
    merged.actions[actionName] = handler;
  }

  for (const [eventName, entry] of Object.entries(def.events ?? {})) {
    merged.events[eventName] = normalizeEvent(entry);
  }

  merged.started = def.started ?? merged.started;
  merged.stopped = def.stopped ?? merged.stopped;

  return merged;
}

function normalizeEvent(
  entry:
    | ServiceEventHandler<any, any, any>
    | ServiceEventDefinition<any, any, any>,
): ServiceEventDefinition<any, any, any> {
  if (typeof entry === "function") {
    return { balanced: false, handler: entry };
  }

  return { balanced: entry.balanced ?? false, handler: entry.handler };
}

export function prefixedActionName(serviceName: string, version: number, actionName: string): string {
  return `v${version}.${serviceName}.${actionName}`;
}
