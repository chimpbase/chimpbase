import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

import {
  confirmReservation,
  getStock,
  releaseReservation,
  reserveStock,
  setStock,
} from "../actions/stock.actions.ts";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

app.put("/stock/:sku", async (c) => {
  const body = await c.req.json();
  const stock = await c.env.action(setStock, { sku: c.req.param("sku"), ...body });
  return c.json(stock);
});

app.get("/stock/:sku", async (c) => {
  const stock = await c.env.action(getStock, c.req.param("sku"));
  if (!stock) return c.json({ error: "stock not found" }, 404);
  return c.json(stock);
});

app.post("/stock/reserve", async (c) => {
  const body = await c.req.json();
  try {
    const reservation = await c.env.action(reserveStock, body);
    return c.json(reservation, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "reservation failed";
    return c.json({ error: message }, 409);
  }
});

app.post("/stock/release", async (c) => {
  const body = await c.req.json();
  const result = await c.env.action(releaseReservation, body.reservationId);
  if (!result) return c.json({ error: "reservation not found or not active" }, 404);
  return c.json(result);
});

app.post("/stock/confirm", async (c) => {
  const body = await c.req.json();
  const result = await c.env.action(confirmReservation, body.reservationId);
  if (!result) return c.json({ error: "reservation not found or not active" }, 404);
  return c.json(result);
});

export { app as inventoryApiApp };
