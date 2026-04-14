import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import {
  cron,
  subscription,
  worker,
} from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";
import { factoryApiApp } from "./src/http/app.ts";
import {
  createFactory,
  listFactories,
} from "./src/modules/factories/factory.actions.ts";
import {
  assignOperator,
  completeOrder,
  createOrder,
  getProductionDashboard,
  listOrders,
  rejectOrder,
  startOrder,
  submitQualityCheck,
} from "./src/modules/production/production.actions.ts";
import {
  listOrderAuditLog,
  listOrderEvents,
  listOrderNotifications,
} from "./src/modules/production/production.audit.actions.ts";
import {
  captureProductionSnapshot,
  listProductionSnapshots,
} from "./src/modules/production/production.cron.ts";
import {
  addQualityReport,
  listFactorySettings,
  listProductionActivityStream,
  listQualityReports,
  setFactorySetting,
} from "./src/modules/production/production.platform.actions.ts";
import {
  auditOrderAssigned,
  auditOrderCompleted,
  auditOrderCreated,
  auditOrderQualityCheck,
  auditOrderRejected,
  auditOrderStarted,
  enqueueOrderCompletedNotification,
  enqueueOrderRejectedAlert,
} from "./src/modules/production/production.subscriptions.ts";
import {
  alertOrderRejected,
  captureOrderCompletedDlq,
  captureOrderRejectedDlq,
  notifyOrderCompleted,
} from "./src/modules/production/production.workers.ts";
import { seedFactoryData } from "./src/modules/production/production.seed.actions.ts";

const registrations = [
  // Factories
  listFactories,
  createFactory,

  // Production orders
  listOrders,
  createOrder,
  assignOperator,
  startOrder,
  submitQualityCheck,
  completeOrder,
  rejectOrder,
  getProductionDashboard,

  // Audit
  listOrderAuditLog,
  listOrderEvents,
  listOrderNotifications,

  // Subscriptions (idempotent — safe across replicas)
  subscription("order.created", auditOrderCreated, { idempotent: true, name: "auditOrderCreated" }),
  subscription("order.assigned", auditOrderAssigned, { idempotent: true, name: "auditOrderAssigned" }),
  subscription("order.started", auditOrderStarted, { idempotent: true, name: "auditOrderStarted" }),
  subscription("order.quality_check", auditOrderQualityCheck, { idempotent: true, name: "auditOrderQualityCheck" }),
  subscription("order.completed", auditOrderCompleted, { idempotent: true, name: "auditOrderCompleted" }),
  subscription("order.completed", enqueueOrderCompletedNotification, { idempotent: true, name: "enqueueOrderCompletedNotification" }),
  subscription("order.rejected", auditOrderRejected, { idempotent: true, name: "auditOrderRejected" }),
  subscription("order.rejected", enqueueOrderRejectedAlert, { idempotent: true, name: "enqueueOrderRejectedAlert" }),

  // Cron — only one replica fires each slot
  cron("production.snapshot", "*/10 * * * *", captureProductionSnapshot),

  // Platform features (KV, Collections, Streams)
  listFactorySettings,
  setFactorySetting,
  addQualityReport,
  listQualityReports,
  listProductionActivityStream,
  listProductionSnapshots,

  // Workers — replicas safely dequeue from shared PostgreSQL queue
  worker("order.completed.notify", notifyOrderCompleted),
  worker("order.completed.notify.dlq", captureOrderCompletedDlq, { dlq: false }),
  worker("order.rejected.alert", alertOrderRejected),
  worker("order.rejected.alert.dlq", captureOrderRejectedDlq, { dlq: false }),

  // Seed
  seedFactoryData,
];

export default {
  httpHandler: factoryApiApp,
  migrations,
  project: {
    name: "factory-controller",
  },
  registrations,
} satisfies ChimpbaseAppDefinitionInput;
