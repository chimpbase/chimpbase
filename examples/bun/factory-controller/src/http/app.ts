import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

import type { CreateFactoryInput } from "../modules/factories/factory.types.ts";
import { createFactory, listFactories } from "../modules/factories/factory.actions.ts";
import type { CreateOrderInput, OrderListFilters } from "../modules/production/production.types.ts";
import {
  assignOperator,
  completeOrder,
  createOrder,
  getProductionDashboard,
  listOrders,
  rejectOrder,
  startOrder,
  submitQualityCheck,
} from "../modules/production/production.actions.ts";
import {
  listOrderAuditLog,
  listOrderEvents,
  listOrderNotifications,
} from "../modules/production/production.audit.actions.ts";
import {
  listProductionSnapshots,
} from "../modules/production/production.cron.ts";
import {
  addQualityReport,
  listFactorySettings,
  listProductionActivityStream,
  listQualityReports,
  setFactorySetting,
} from "../modules/production/production.platform.actions.ts";
import { seedFactoryData } from "../modules/production/production.seed.actions.ts";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

// ── Factories ──────────────────────────────────────────────────────────

app.get("/factories", async (c) => {
  const factories = await c.env.action(listFactories);
  return c.json(factories);
});

app.post("/factories", async (c) => {
  const body = await c.req.json<CreateFactoryInput>();
  const factory = await c.env.action(createFactory, body);
  return c.json(factory, 201);
});

// ── Production Orders ──────────────────────────────────────────────────

app.get("/orders", async (c) => {
  const filters: OrderListFilters = {
    factoryCode: c.req.query("factoryCode") ?? undefined,
    operatorEmail: c.req.query("operatorEmail") ?? undefined,
    priority: c.req.query("priority") ?? undefined,
    status: c.req.query("status") ?? undefined,
  };
  const orders = await c.env.action(listOrders, filters);
  return c.json(orders);
});

app.post("/orders", async (c) => {
  const body = await c.req.json<CreateOrderInput>();
  const order = await c.env.action(createOrder, body);
  return c.json(order, 201);
});

app.post("/orders/:id/assign", async (c) => {
  const body = await c.req.json<{ operatorEmail: string }>();
  const orderId = Number(c.req.param("id"));
  const order = await c.env.action(assignOperator, {
    operatorEmail: body.operatorEmail,
    orderId,
  });
  return c.json(order);
});

app.post("/orders/:id/start", async (c) => {
  const orderId = Number(c.req.param("id"));
  const order = await c.env.action(startOrder, { orderId });
  return c.json(order);
});

app.post("/orders/:id/quality-check", async (c) => {
  const orderId = Number(c.req.param("id"));
  const order = await c.env.action(submitQualityCheck, { orderId });
  return c.json(order);
});

app.post("/orders/:id/complete", async (c) => {
  const orderId = Number(c.req.param("id"));
  const order = await c.env.action(completeOrder, { orderId });
  return c.json(order);
});

app.post("/orders/:id/reject", async (c) => {
  const body = await c.req.json<{ reason?: string }>().catch((): { reason?: string } => ({}));
  const orderId = Number(c.req.param("id"));
  const order = await c.env.action(rejectOrder, { orderId, reason: body.reason });
  return c.json(order);
});

// ── Dashboard ──────────────────────────────────────────────────────────

app.get("/dashboard", async (c) => {
  const dashboard = await c.env.action(getProductionDashboard, {
    factoryCode: c.req.query("factoryCode") ?? undefined,
  });
  return c.json(dashboard);
});

// ── Audit & Events ─────────────────────────────────────────────────────

app.get("/audit-log", async (c) => {
  const log = await c.env.action(listOrderAuditLog);
  return c.json(log);
});

app.get("/events", async (c) => {
  const events = await c.env.action(listOrderEvents);
  return c.json(events);
});

app.get("/notifications", async (c) => {
  const notifications = await c.env.action(listOrderNotifications);
  return c.json(notifications);
});

// ── Snapshots (cron) ───────────────────────────────────────────────────

app.get("/snapshots", async (c) => {
  const snapshots = await c.env.action(listProductionSnapshots);
  return c.json(snapshots);
});

// ── Factory Settings (KV) ──────────────────────────────────────────────

app.get("/settings", async (c) => {
  const settings = await c.env.action(listFactorySettings);
  return c.json(settings);
});

app.put("/settings/:key", async (c) => {
  const value = await c.req.json<unknown>();
  const setting = await c.env.action(setFactorySetting, {
    key: c.req.param("key"),
    value,
  });
  return c.json(setting);
});

// ── Quality Reports (Collections) ──────────────────────────────────────

app.post("/quality-reports", async (c) => {
  const body = await c.req.json<{
    inspector: string;
    notes: string;
    orderId: number;
    passed: boolean;
  }>();
  const report = await c.env.action(addQualityReport, body);
  return c.json(report, 201);
});

app.get("/quality-reports", async (c) => {
  const orderId = Number(c.req.query("orderId"));
  const reports = await c.env.action(listQualityReports, { orderId });
  return c.json(reports);
});

// ── Activity Stream (Streams) ──────────────────────────────────────────

app.get("/activity-stream", async (c) => {
  const events = await c.env.action(listProductionActivityStream, {
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    sinceId: c.req.query("sinceId") ? Number(c.req.query("sinceId")) : undefined,
    stream: c.req.query("stream") ?? undefined,
  });
  return c.json(events);
});

// ── Seed ────────────────────────────────────────────────────────────────

app.post("/seed", async (c) => {
  const result = await c.env.action(seedFactoryData);
  return c.json(result, 201);
});

const factoryApiApp = app;

export { factoryApiApp };
