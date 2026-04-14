import type { ChimpbaseAppDefinitionInput } from "@chimpbase/bun";
import { cron, subscription } from "@chimpbase/runtime";

import { inventoryApiApp } from "./src/http/app.ts";
import {
  confirmReservation,
  getStock,
  releaseReservation,
  reserveStock,
  setStock,
} from "./src/actions/stock.actions.ts";
import { checkLowStock } from "./src/cron/low-stock-check.ts";
import { logLowStock, logStockReserved } from "./src/subscriptions/activity.ts";

const registrations = [
  // ── Actions ──────────────────────────────────────────────────────────
  setStock,
  getStock,
  reserveStock,
  releaseReservation,
  confirmReservation,

  // ── Cron ─────────────────────────────────────────────────────────────
  cron("inventory.low-stock-check", "*/5 * * * *", checkLowStock),

  // ── Subscriptions ────────────────────────────────────────────────────
  subscription("stock.reserved", logStockReserved, { idempotent: true, name: "logStockReserved" }),
  subscription("stock.low", logLowStock, { idempotent: true, name: "logLowStock" }),
];

export const SERVER_PORT = 4011;

export default {
  httpHandler: inventoryApiApp,
  project: { name: "ecommerce-inventory" },
  telemetry: {
    minLevel: "info" as const,
    persist: { log: true, metric: true, trace: true },
  },
  registrations,
} satisfies ChimpbaseAppDefinitionInput;
