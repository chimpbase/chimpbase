import {
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  type CreateOrderInput,
  type NormalizedCreateOrderInput,
  type NormalizedOrderListFilters,
  type OrderListFilters,
  type OrderPriority,
  type OrderStatus,
} from "./production.types.ts";

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["quality_check", "rejected"],
  quality_check: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

export function assertStatusTransition(current: string, target: OrderStatus): void {
  const allowed = VALID_TRANSITIONS[current as OrderStatus];
  if (!allowed || !allowed.includes(target)) {
    throw new Error(`cannot transition from "${current}" to "${target}"`);
  }
}

export function normalizeCreateOrderInput(input: CreateOrderInput): NormalizedCreateOrderInput {
  const productSku = input.productSku?.trim().toUpperCase();
  if (!productSku) {
    throw new Error("productSku is required");
  }

  const factoryCode = input.factoryCode?.trim().toLowerCase();
  if (!factoryCode) {
    throw new Error("factoryCode is required");
  }

  if (!input.quantity || input.quantity < 1) {
    throw new Error("quantity must be at least 1");
  }

  const priority = (input.priority?.trim().toLowerCase() ?? "normal") as OrderPriority;
  if (!ORDER_PRIORITIES.includes(priority)) {
    throw new Error(`invalid priority: ${input.priority}`);
  }

  const operatorEmail = input.operatorEmail?.trim().toLowerCase() || null;

  return {
    factoryCode,
    operatorEmail,
    priority,
    productSku,
    quantity: input.quantity,
  };
}

export function normalizeOrderFilters(filters: OrderListFilters): NormalizedOrderListFilters {
  const status = filters.status?.trim().toLowerCase() as OrderStatus | undefined;
  if (status && !ORDER_STATUSES.includes(status)) {
    throw new Error(`invalid status filter: ${filters.status}`);
  }

  const priority = filters.priority?.trim().toLowerCase() as OrderPriority | undefined;
  if (priority && !ORDER_PRIORITIES.includes(priority)) {
    throw new Error(`invalid priority filter: ${filters.priority}`);
  }

  return {
    factoryCode: filters.factoryCode?.trim().toLowerCase() || null,
    operatorEmail: filters.operatorEmail?.trim().toLowerCase() || null,
    priority: priority ?? null,
    status: status ?? null,
  };
}
