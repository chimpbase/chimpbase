import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { subscription, worker } from "@chimpbase/runtime";

import { paymentsApiApp } from "./src/http/app.ts";
import {
  getPayment,
  initiatePayment,
  refundPayment,
} from "./src/actions/payment.actions.ts";
import {
  handlePaymentProcessorDlq,
  processPayment,
} from "./src/workers/payment-processor.ts";
import { logPaymentRefunded } from "./src/subscriptions/activity.ts";

const registrations = [
  // ── Actions ──────────────────────────────────────────────────────────
  initiatePayment,
  getPayment,
  refundPayment,

  // ── Workers ─────────────────────────────────────────────────────────
  worker("payment.process", processPayment, { dlq: "payment.process.dlq" }),
  worker("payment.process.dlq", handlePaymentProcessorDlq, { dlq: false }),

  // ── Subscriptions ────────────────────────────────────────────────────
  subscription("payment.refunded", logPaymentRefunded, { idempotent: true, name: "logPaymentRefunded" }),
];

export const SERVER_PORT = 4012;

export default {
  httpHandler: paymentsApiApp,
  project: { name: "ecommerce-payments" },
  worker: { maxAttempts: 3, retryDelayMs: 5000 },
  telemetry: {
    minLevel: "info" as const,
    persist: { log: true, metric: true, trace: true },
  },
  registrations,
} satisfies ChimpbaseAppDefinitionInput;
