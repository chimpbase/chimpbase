import type { ChimpbaseAppDefinitionInput } from "@chimpbase/node";
import { action, route, v } from "@chimpbase/runtime";

import migrations from "./chimpbase.migrations.ts";

type OrderRow = {
  id: number;
  customer: string;
  amount: number;
  created_at: string;
};

const createOrder = action({
  name: "createOrder",
  args: v.object({
    customer: v.string(),
    amount: v.number(),
  }),
  async handler(ctx, input) {
    const [row] = await ctx.db.query<OrderRow>(
      "INSERT INTO orders (customer, amount) VALUES (?1, ?2) RETURNING id, customer, amount, created_at",
      [input.customer, input.amount],
    );
    return row;
  },
});

const listOrders = action({
  name: "listOrders",
  async handler(ctx) {
    return await ctx.db.query<OrderRow>(
      "SELECT id, customer, amount, created_at FROM orders ORDER BY id",
    );
  },
});

const ordersRoute = route("orders", async (request, env) => {
  const url = new URL(request.url);

  if (url.pathname !== "/orders") return null;

  if (request.method === "POST") {
    const body = (await request.json()) as { customer: string; amount: number };
    const order = await env.action("createOrder", body);
    return Response.json(order, { status: 201 });
  }

  if (request.method === "GET") {
    const orders = await env.action("listOrders", {});
    return Response.json(orders);
  }

  return null;
});

export default {
  migrations,
  project: { name: "node-basic" },
  registrations: [createOrder, listOrders, ordersRoute],
} satisfies ChimpbaseAppDefinitionInput;
