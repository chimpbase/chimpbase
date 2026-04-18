import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { chimpbaseAuth } from "@chimpbase/auth";
import { chimpbaseWebhooks } from "@chimpbase/webhooks";
import { restCollections } from "@chimpbase/rest-collections";
import { cron, subscription, worker } from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
import { orderApiApp } from "./src/http/app.ts";
import {
  assignOrder,
  completeOrder,
  createOrder,
  listOrders,
  rejectOrder,
  startOrder,
} from "./src/modules/orders/order.actions.ts";
import {
  listOrderEvents,
  listOrderNotifications,
} from "./src/modules/orders/order.audit.actions.ts";
import {
  captureOrderBacklogSnapshot,
  listOrderBacklogSnapshots,
} from "./src/modules/orders/order.cron.ts";
import {
  getFulfilmentStatus,
  signalQualityDecision,
  startOrderFulfilment,
} from "./src/modules/orders/order.fulfilment.actions.ts";
import {
  auditOrderAssigned,
  auditOrderCompleted,
  auditOrderCreated,
  auditOrderRejected,
  auditOrderStarted,
  enqueueOrderCompletedNotification,
} from "./src/modules/orders/order.subscriptions.ts";
import {
  captureOrderCompletedDlq,
  notifyOrderCompleted,
} from "./src/modules/orders/order.workers.ts";
import { orderFulfilmentWorkflow } from "./src/modules/orders/order.workflow.ts";

export default {
  httpHandler: orderApiApp,
  migrations,
  project: { name: "bun-advanced" },
  registrations: [
    chimpbaseAuth({
      bootstrapKeySecret: "CHIMPBASE_BOOTSTRAP_API_KEY",
      excludePaths: ["/health"],
    }),
    chimpbaseWebhooks({
      allowedEvents: ["order.completed", "order.rejected"],
    }),
    restCollections({
      basePath: "/api",
      collections: {
        quality_reports: {
          collection: "quality_reports",
          filterableFields: ["orderId", "reviewer"],
        },
      },
    }),

    orderFulfilmentWorkflow,

    createOrder,
    listOrders,
    assignOrder,
    startOrder,
    completeOrder,
    rejectOrder,
    listOrderEvents,
    listOrderNotifications,
    listOrderBacklogSnapshots,
    startOrderFulfilment,
    getFulfilmentStatus,
    signalQualityDecision,

    subscription("order.created", auditOrderCreated, {
      idempotent: true,
      name: "auditOrderCreated",
    }),
    subscription("order.assigned", auditOrderAssigned, {
      idempotent: true,
      name: "auditOrderAssigned",
    }),
    subscription("order.started", auditOrderStarted, {
      idempotent: true,
      name: "auditOrderStarted",
    }),
    subscription("order.completed", auditOrderCompleted, {
      idempotent: true,
      name: "auditOrderCompleted",
    }),
    subscription("order.completed", enqueueOrderCompletedNotification, {
      idempotent: true,
      name: "enqueueOrderCompletedNotification",
    }),
    subscription("order.rejected", auditOrderRejected, {
      idempotent: true,
      name: "auditOrderRejected",
    }),

    worker("order.completed.notify", notifyOrderCompleted),
    worker("order.completed.notify.dlq", captureOrderCompletedDlq, { dlq: false }),

    cron("orders.backlog.snapshot", "*/15 * * * *", captureOrderBacklogSnapshot),
  ],
} satisfies ChimpbaseAppDefinitionInput;
