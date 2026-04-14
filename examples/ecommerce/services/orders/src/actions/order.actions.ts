import { action, type ChimpbaseContext } from "@chimpbase/runtime";
import * as pimClient from "../clients/pim.client.ts";
import * as inventoryClient from "../clients/inventory.client.ts";
import * as paymentsClient from "../clients/payments.client.ts";

const ORDERS_COLLECTION = "orders";
const ORDER_ITEMS_COLLECTION = "order_items";

export interface OrderRecord {
  id: string;
  customerEmail: string;
  status: string;
  totalAmount: number;
  currency: string;
  paymentId: string | null;
  workflowId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemRecord {
  id: string;
  orderId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  reservationId: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Public actions (exposed via HTTP) ───────────────────────────────────

export const createOrder = action(
  "createOrder",
  async (
    ctx: ChimpbaseContext,
    input: {
      customerEmail: string;
      items: Array<{ sku: string; quantity: number }>;
    },
  ) => {
    const now = nowIso();
    const orderId = await ctx.collection.insert(ORDERS_COLLECTION, {
      customerEmail: input.customerEmail,
      status: "created",
      totalAmount: 0,
      currency: "USD",
      paymentId: null,
      workflowId: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    });

    for (const item of input.items) {
      await ctx.collection.insert(ORDER_ITEMS_COLLECTION, {
        orderId,
        sku: item.sku,
        productName: "",
        quantity: item.quantity,
        unitPrice: 0,
        reservationId: null,
      });
    }

    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id: orderId });
    const items = await ctx.collection.find<OrderItemRecord>(ORDER_ITEMS_COLLECTION, { orderId });

    ctx.pubsub.publish("order.created", { order, items });
    ctx.log.info("order created", { orderId, customerEmail: input.customerEmail, itemCount: input.items.length });
    ctx.metric("order.created", 1);
    return { ...order, items };
  },
);

export const getOrder = action(
  "getOrder",
  async (ctx: ChimpbaseContext, id: string) => {
    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id });
    if (!order) return null;
    const items = await ctx.collection.find<OrderItemRecord>(ORDER_ITEMS_COLLECTION, { orderId: id });
    return { ...order, items };
  },
);

export const listOrders = action(
  "listOrders",
  async (ctx: ChimpbaseContext, input?: { status?: string }) => {
    const filter: Record<string, unknown> = {};
    if (input?.status) filter.status = input.status;
    return await ctx.collection.find<OrderRecord>(ORDERS_COLLECTION, filter);
  },
);

export const startCheckout = action(
  "startCheckout",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id: orderId });
    if (!order) throw new Error("Order not found");
    if (order.status !== "created") throw new Error(`Cannot checkout order in status: ${order.status}`);

    // Import the workflow reference dynamically to avoid circular deps
    const { checkoutWorkflow } = await import("../workflows/checkout.workflow.ts");

    const workflowId = `order-${orderId}`;
    await ctx.workflow.start(checkoutWorkflow, { orderId }, { workflowId });

    await ctx.collection.update(ORDERS_COLLECTION, { id: orderId }, {
      status: "checkout_started",
      workflowId,
      updatedAt: nowIso(),
    });

    ctx.log.info("checkout started", { orderId, workflowId });
    ctx.metric("order.checkout_started", 1);
    return { orderId, workflowId, status: "checkout_started" };
  },
);

export const handlePaymentResult = action(
  "handlePaymentResult",
  async (
    ctx: ChimpbaseContext,
    input: {
      orderId: string;
      paymentId: string;
      status: string;
      failureReason?: string | null;
    },
  ) => {
    const workflowId = `order-${input.orderId}`;
    await ctx.workflow.signal(workflowId, "payment.result", {
      paymentId: input.paymentId,
      status: input.status,
      failureReason: input.failureReason ?? null,
    });

    ctx.log.info("payment result received", { orderId: input.orderId, paymentId: input.paymentId, status: input.status });
    return { signaled: true };
  },
);

export const cancelOrder = action(
  "cancelOrder",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id: orderId });
    if (!order) throw new Error("Order not found");

    if (order.workflowId) {
      await ctx.workflow.signal(order.workflowId, "order.cancel", {});
    }

    await ctx.collection.update(ORDERS_COLLECTION, { id: orderId }, {
      status: "cancelled",
      updatedAt: nowIso(),
    });

    ctx.pubsub.publish("order.cancelled", { orderId });
    ctx.log.info("order cancelled", { orderId });
    ctx.metric("order.cancelled", 1);
    return { orderId, status: "cancelled" };
  },
);

// ── Internal actions (called by workflow) ───────────────────────────────

export const validateOrderItems = action(
  "validateOrderItems",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const items = await ctx.collection.find<OrderItemRecord>(ORDER_ITEMS_COLLECTION, { orderId });
    let totalAmount = 0;

    for (const item of items) {
      const product = await pimClient.getProductBySku(ctx, item.sku);
      if (!product) {
        return { valid: false, error: `Product not found: ${item.sku}` };
      }
      if (!product.active) {
        return { valid: false, error: `Product is not active: ${item.sku}` };
      }

      // Update item with product info
      await ctx.collection.update(ORDER_ITEMS_COLLECTION, { id: item.id }, {
        productName: product.name,
        unitPrice: product.price,
      });

      totalAmount += product.price * item.quantity;
    }

    // Update order total
    await ctx.collection.update(ORDERS_COLLECTION, { id: orderId }, {
      totalAmount,
      updatedAt: nowIso(),
    });

    ctx.log.info("order items validated", { orderId, totalAmount, itemCount: items.length });
    return { valid: true, totalAmount };
  },
);

export const reserveOrderStock = action(
  "reserveOrderStock",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const items = await ctx.collection.find<OrderItemRecord>(ORDER_ITEMS_COLLECTION, { orderId });
    const reservationIds: string[] = [];

    try {
      for (const item of items) {
        const reservation = await inventoryClient.reserveStock(ctx, orderId, item.sku, item.quantity);
        reservationIds.push(reservation.id);
        await ctx.collection.update(ORDER_ITEMS_COLLECTION, { id: item.id }, {
          reservationId: reservation.id,
        });
      }
      ctx.log.info("order stock reserved", { orderId, reservations: reservationIds.length });
      return { success: true, reservationIds };
    } catch (err: unknown) {
      // Compensate: release any already-made reservations
      for (const resId of reservationIds) {
        try {
          await inventoryClient.releaseReservation(ctx, resId);
        } catch {
          ctx.log.error("failed to release reservation during compensation", { reservationId: resId });
        }
      }
      const message = err instanceof Error ? err.message : "stock reservation failed";
      ctx.log.error("order stock reservation failed", { orderId, error: message });
      return { success: false, error: message, reservationIds: [] };
    }
  },
);

export const releaseOrderStock = action(
  "releaseOrderStock",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const items = await ctx.collection.find<OrderItemRecord>(ORDER_ITEMS_COLLECTION, { orderId });
    for (const item of items) {
      if (item.reservationId) {
        try {
          await inventoryClient.releaseReservation(ctx, item.reservationId);
        } catch {
          ctx.log.error("failed to release reservation", { reservationId: item.reservationId });
        }
      }
    }
    ctx.log.info("order stock released", { orderId });
  },
);

export const confirmOrderStock = action(
  "confirmOrderStock",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const items = await ctx.collection.find<OrderItemRecord>(ORDER_ITEMS_COLLECTION, { orderId });
    for (const item of items) {
      if (item.reservationId) {
        await inventoryClient.confirmReservation(ctx, item.reservationId);
      }
    }
    ctx.log.info("order stock confirmed", { orderId });
  },
);

export const requestPayment = action(
  "requestPayment",
  async (ctx: ChimpbaseContext, orderId: string) => {
    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id: orderId });
    if (!order) throw new Error("Order not found");

    const callbackUrl = `http://localhost:4013/webhooks/payments`;
    const payment = await paymentsClient.initiatePayment(
      ctx,
      orderId,
      order.totalAmount,
      order.currency,
      callbackUrl,
    );

    await ctx.collection.update(ORDERS_COLLECTION, { id: orderId }, {
      paymentId: payment.id,
      updatedAt: nowIso(),
    });

    ctx.log.info("payment requested", { orderId, paymentId: payment.id, amount: order.totalAmount });
    return { paymentId: payment.id };
  },
);

export const completeOrder = action(
  "completeOrder",
  async (ctx: ChimpbaseContext, orderId: string) => {
    await ctx.collection.update(ORDERS_COLLECTION, { id: orderId }, {
      status: "completed",
      updatedAt: nowIso(),
    });

    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id: orderId });
    ctx.pubsub.publish("order.completed", order);
    ctx.log.info("order completed", { orderId });
    ctx.metric("order.completed", 1);
  },
);

export const failOrder = action(
  "failOrder",
  async (ctx: ChimpbaseContext, input: { orderId: string; reason: string }) => {
    await ctx.collection.update(ORDERS_COLLECTION, { id: input.orderId }, {
      status: "failed",
      failureReason: input.reason,
      updatedAt: nowIso(),
    });

    const order = await ctx.collection.findOne<OrderRecord>(ORDERS_COLLECTION, { id: input.orderId });
    ctx.pubsub.publish("order.failed", order);
    ctx.log.info("order failed", { orderId: input.orderId, reason: input.reason });
    ctx.metric("order.failed", 1);
  },
);
