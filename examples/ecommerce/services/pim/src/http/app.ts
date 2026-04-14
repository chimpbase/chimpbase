import type { ChimpbaseRouteEnv } from "@chimpbase/runtime";
import { Hono } from "hono";

import {
  createProduct,
  getProduct,
  getProductBySku,
  listProducts,
  updateProduct,
} from "../actions/product.actions.ts";

const app = new Hono<{ Bindings: ChimpbaseRouteEnv }>();

app.post("/products", async (c) => {
  const body = await c.req.json();
  const product = await c.env.action(createProduct, body);
  return c.json(product, 201);
});

app.get("/products", async (c) => {
  const categoryId = c.req.query("categoryId");
  const active = c.req.query("active");
  const products = await c.env.action(listProducts, {
    categoryId: categoryId || undefined,
    active: active !== undefined ? active === "true" : undefined,
  });
  return c.json(products);
});

app.get("/products/:id", async (c) => {
  const product = await c.env.action(getProduct, c.req.param("id"));
  if (!product) return c.json({ error: "product not found" }, 404);
  return c.json(product);
});

app.get("/products/sku/:sku", async (c) => {
  const product = await c.env.action(getProductBySku, c.req.param("sku"));
  if (!product) return c.json({ error: "product not found" }, 404);
  return c.json(product);
});

app.patch("/products/:id", async (c) => {
  const body = await c.req.json();
  const product = await c.env.action(updateProduct, { id: c.req.param("id"), ...body });
  if (!product) return c.json({ error: "product not found" }, 404);
  return c.json(product);
});

export { app as pimApiApp };
