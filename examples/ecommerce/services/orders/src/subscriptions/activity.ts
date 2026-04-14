import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { OrderRecord } from "../actions/order.actions.ts";

export async function logOrderCreated(
  ctx: ChimpbaseContext,
  payload: { order: OrderRecord; items: unknown[] },
): Promise<void> {
  await ctx.stream.append("orders.activity", "order.created", {
    orderId: payload.order.id,
    customerEmail: payload.order.customerEmail,
    itemCount: payload.items.length,
  });
}

export async function logOrderCompleted(ctx: ChimpbaseContext, order: OrderRecord): Promise<void> {
  await ctx.stream.append("orders.activity", "order.completed", {
    orderId: order.id,
    totalAmount: order.totalAmount,
  });
}

export async function logOrderFailed(ctx: ChimpbaseContext, order: OrderRecord): Promise<void> {
  await ctx.stream.append("orders.activity", "order.failed", {
    orderId: order.id,
    reason: order.failureReason,
  });
}
