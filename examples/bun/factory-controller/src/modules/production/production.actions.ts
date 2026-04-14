import { action, type ChimpbaseContext, v } from "@chimpbase/runtime";
import {
  assertStatusTransition,
  normalizeCreateOrderInput,
  normalizeOrderFilters,
} from "./production.domain.ts";
import {
  getProductionDashboard as getDashboardFromRepo,
  insertOrder,
  listOrders as listOrdersFromRepo,
  requireOrderById,
  updateOrderOperator,
  updateOrderStatus,
} from "./production.repository.ts";
import { requireFactoryByCode } from "../factories/factory.repository.ts";
import type {
  CreateOrderInput,
  OrderListFilters,
  ProductionDashboard,
  ProductionOrderRecord,
} from "./production.types.ts";

const listOrders = action({
  args: v.object({
    factoryCode: v.optional(v.string()),
    operatorEmail: v.optional(v.string()),
    priority: v.optional(v.string()),
    status: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    filters: OrderListFilters,
  ): Promise<ProductionOrderRecord[]> {
    return await listOrdersFromRepo(ctx, normalizeOrderFilters(filters));
  },
  name: "listOrders",
});

const createOrder = action({
  args: v.object({
    factoryCode: v.string(),
    operatorEmail: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(v.string()),
    productSku: v.string(),
    quantity: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: CreateOrderInput,
  ): Promise<ProductionOrderRecord> {
    const normalized = normalizeCreateOrderInput(input);
    const factory = await requireFactoryByCode(ctx, normalized.factoryCode);
    const order = await insertOrder(ctx, factory.id, normalized);
    ctx.pubsub.publish("order.created", order);
    return order;
  },
  name: "createOrder",
});

const assignOperator = action({
  args: v.object({
    operatorEmail: v.string(),
    orderId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { operatorEmail: string; orderId: number },
  ): Promise<ProductionOrderRecord> {
    await requireOrderById(ctx, input.orderId);
    const email = input.operatorEmail.trim().toLowerCase();
    if (!email) throw new Error("operatorEmail is required");
    const order = await updateOrderOperator(ctx, input.orderId, email);
    ctx.pubsub.publish("order.assigned", order);
    return order;
  },
  name: "assignOperator",
});

const startOrder = action({
  args: v.object({
    orderId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { orderId: number },
  ): Promise<ProductionOrderRecord> {
    const current = await requireOrderById(ctx, input.orderId);
    assertStatusTransition(current.status, "in_progress");
    const order = await updateOrderStatus(ctx, input.orderId, "in_progress");
    ctx.pubsub.publish("order.started", order);
    return order;
  },
  name: "startOrder",
});

const submitQualityCheck = action({
  args: v.object({
    orderId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { orderId: number },
  ): Promise<ProductionOrderRecord> {
    const current = await requireOrderById(ctx, input.orderId);
    assertStatusTransition(current.status, "quality_check");
    const order = await updateOrderStatus(ctx, input.orderId, "quality_check");
    ctx.pubsub.publish("order.quality_check", order);
    return order;
  },
  name: "submitQualityCheck",
});

const completeOrder = action({
  args: v.object({
    orderId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { orderId: number },
  ): Promise<ProductionOrderRecord> {
    const current = await requireOrderById(ctx, input.orderId);
    assertStatusTransition(current.status, "completed");
    const order = await updateOrderStatus(ctx, input.orderId, "completed");
    ctx.pubsub.publish("order.completed", order);
    return order;
  },
  name: "completeOrder",
});

const rejectOrder = action({
  args: v.object({
    orderId: v.number(),
    reason: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { orderId: number; reason?: string },
  ): Promise<ProductionOrderRecord> {
    const current = await requireOrderById(ctx, input.orderId);
    assertStatusTransition(current.status, "rejected");
    const order = await updateOrderStatus(ctx, input.orderId, "rejected");
    ctx.pubsub.publish("order.rejected", { ...order, rejectionReason: input.reason ?? "" });
    return order;
  },
  name: "rejectOrder",
});

const getProductionDashboard = action({
  args: v.object({
    factoryCode: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { factoryCode?: string },
  ): Promise<ProductionDashboard> {
    const code = input.factoryCode?.trim().toLowerCase() || null;
    return await getDashboardFromRepo(ctx, code);
  },
  name: "getProductionDashboard",
});

export {
  assignOperator,
  completeOrder,
  createOrder,
  getProductionDashboard,
  listOrders,
  rejectOrder,
  startOrder,
  submitQualityCheck,
};
