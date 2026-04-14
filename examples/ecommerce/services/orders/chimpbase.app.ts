import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { chimpbaseWebhooks, headerToken } from "@chimpbase/webhooks";
import { subscription } from "@chimpbase/runtime";

import { ordersApiApp } from "./src/http/app.ts";
import {
  cancelOrder,
  completeOrder,
  confirmOrderStock,
  createOrder,
  failOrder,
  getOrder,
  handlePaymentResult,
  listOrders,
  releaseOrderStock,
  requestPayment,
  reserveOrderStock,
  startCheckout,
  validateOrderItems,
} from "./src/actions/order.actions.ts";
import { checkoutWorkflow } from "./src/workflows/checkout.workflow.ts";
import {
  logOrderCompleted,
  logOrderCreated,
  logOrderFailed,
} from "./src/subscriptions/activity.ts";

const registrations = [
  // ── Plugins ─────────────────────────────────────────────────────────
  chimpbaseWebhooks({
    allowedEvents: ["order.created", "order.completed", "order.failed", "order.cancelled"],
    inbound: {
      payments: {
        path: "/webhooks/payments",
        publishAs: "payment.callback.received",
        verify: headerToken({
          header: "x-service-token",
          secretName: "PAYMENTS_WEBHOOK_SECRET",
        }),
      },
    },
  }),

  // ── Public actions ──────────────────────────────────────────────────
  createOrder,
  getOrder,
  listOrders,
  startCheckout,
  handlePaymentResult,
  cancelOrder,

  // ── Internal actions (called by workflow) ───────────────────────────
  validateOrderItems,
  reserveOrderStock,
  releaseOrderStock,
  confirmOrderStock,
  requestPayment,
  completeOrder,
  failOrder,

  // ── Workflow ────────────────────────────────────────────────────────
  checkoutWorkflow,

  // ── Subscriptions ──────────────────────────────────────────────────
  subscription("order.created", logOrderCreated, { idempotent: true, name: "logOrderCreated" }),
  subscription("order.completed", logOrderCompleted, { idempotent: true, name: "logOrderCompleted" }),
  subscription("order.failed", logOrderFailed, { idempotent: true, name: "logOrderFailed" }),
  subscription("payment.callback.received", async (ctx, payload) => {
    const p = payload as { orderId: string; paymentId: string; status: string; failureReason?: string | null };
    await ctx.action("handlePaymentResult", {
      orderId: p.orderId,
      paymentId: p.paymentId,
      status: p.status,
      failureReason: p.failureReason,
    });
  }, { idempotent: true, name: "handlePaymentCallback" }),
];

export const SERVER_PORT = 4013;

export default {
  httpHandler: ordersApiApp,
  project: { name: "ecommerce-orders" },
  telemetry: {
    minLevel: "info" as const,
    persist: { log: true, metric: true, trace: true },
  },
  registrations,
} satisfies ChimpbaseAppDefinitionInput;
