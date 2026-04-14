import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

import {
  cancelOrder,
  createOrder,
  getOrder,
  listOrders,
  startCheckout,
} from "../actions/order.actions.ts";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

app.post("/orders", async (c) => {
  const body = await c.req.json();
  const order = await c.env.action(createOrder, body);
  return c.json(order, 201);
});

app.get("/orders", async (c) => {
  const status = c.req.query("status");
  const orders = await c.env.action(listOrders, { status: status || undefined });
  return c.json(orders);
});

app.get("/orders/:id", async (c) => {
  const order = await c.env.action(getOrder, c.req.param("id"));
  if (!order) return c.json({ error: "order not found" }, 404);
  return c.json(order);
});

app.post("/orders/:id/checkout", async (c) => {
  try {
    const result = await c.env.action(startCheckout, c.req.param("id"));
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "checkout failed";
    return c.json({ error: message }, 400);
  }
});

app.post("/orders/:id/cancel", async (c) => {
  try {
    const result = await c.env.action(cancelOrder, c.req.param("id"));
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "cancel failed";
    return c.json({ error: message }, 400);
  }
});

export { app as ordersApiApp };
