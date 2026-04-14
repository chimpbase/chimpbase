import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

import {
  getPayment,
  initiatePayment,
  refundPayment,
} from "../actions/payment.actions.ts";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

app.post("/payments", async (c) => {
  const body = await c.req.json();
  const payment = await c.env.action(initiatePayment, body);
  return c.json(payment, 201);
});

app.get("/payments/:id", async (c) => {
  const payment = await c.env.action(getPayment, c.req.param("id"));
  if (!payment) return c.json({ error: "payment not found" }, 404);
  return c.json(payment);
});

app.post("/payments/:id/refund", async (c) => {
  try {
    const payment = await c.env.action(refundPayment, c.req.param("id"));
    if (!payment) return c.json({ error: "payment not found" }, 404);
    return c.json(payment);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "refund failed";
    return c.json({ error: message }, 409);
  }
});

export { app as paymentsApiApp };
