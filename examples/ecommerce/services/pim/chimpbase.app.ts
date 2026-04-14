import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { chimpbaseWebhooks } from "@chimpbase/webhooks";
import { subscription } from "@chimpbase/runtime";

import { pimApiApp } from "./src/http/app.ts";
import {
  createProduct,
  getProduct,
  getProductBySku,
  listProducts,
  updateProduct,
} from "./src/actions/product.actions.ts";
import {
  logProductCreated,
  logProductUpdated,
} from "./src/subscriptions/activity.ts";

const registrations = [
  chimpbaseWebhooks({
    allowedEvents: ["product.created", "product.updated"],
  }),

  // ── Actions ──────────────────────────────────────────────────────────
  createProduct,
  getProduct,
  getProductBySku,
  listProducts,
  updateProduct,

  // ── Subscriptions ────────────────────────────────────────────────────
  subscription("product.created", logProductCreated, { idempotent: true, name: "logProductCreated" }),
  subscription("product.updated", logProductUpdated, { idempotent: true, name: "logProductUpdated" }),
];

export const SERVER_PORT = 4010;

export default {
  httpHandler: pimApiApp,
  project: { name: "ecommerce-pim" },
  telemetry: {
    minLevel: "info" as const,
    persist: { log: true, metric: true, trace: true },
  },
  registrations,
} satisfies ChimpbaseAppDefinitionInput;
