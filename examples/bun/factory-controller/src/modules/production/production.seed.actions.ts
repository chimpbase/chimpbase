import { action, type ChimpbaseContext } from "@chimpbase/runtime";
import { createFactory } from "../factories/factory.actions.ts";
import { createOrder } from "./production.actions.ts";
import type { FactoryRecord } from "../factories/factory.types.ts";
import type {
  CreateOrderInput,
  ProductionOrderRecord,
  SeedFactoryDataResult,
} from "./production.types.ts";

const seedFactoryData = action({
  async handler(ctx: ChimpbaseContext): Promise<SeedFactoryDataResult> {
    const factories = [
      { name: "Assembly Line Alpha", managerEmail: "alpha-mgr@factory.dev" },
      { name: "Assembly Line Beta", managerEmail: "beta-mgr@factory.dev" },
    ];

    const seededFactories: FactoryRecord[] = [];
    for (const input of factories) {
      seededFactories.push(await createFactory(input));
    }

    const orders: CreateOrderInput[] = [
      {
        factoryCode: "assembly-line-alpha",
        operatorEmail: "operator-a@factory.dev",
        priority: "high",
        productSku: "WIDGET-100",
        quantity: 500,
      },
      {
        factoryCode: "assembly-line-alpha",
        operatorEmail: "operator-b@factory.dev",
        priority: "normal",
        productSku: "GADGET-200",
        quantity: 250,
      },
      {
        factoryCode: "assembly-line-beta",
        operatorEmail: "operator-c@factory.dev",
        priority: "urgent",
        productSku: "SPROCKET-50",
        quantity: 1000,
      },
    ];

    const createdOrders: ProductionOrderRecord[] = [];
    for (const orderInput of orders) {
      const existing = await ctx.db.query<ProductionOrderRecord>(
        `SELECT
           o.id, o.factory_id, f.code AS factory_code, f.name AS factory_name,
           o.product_sku, o.quantity, o.status, o.priority, o.operator_email,
           o.started_at, o.completed_at, o.rejected_at, o.created_at, o.updated_at
         FROM production_orders o
         INNER JOIN factories f ON f.id = o.factory_id
         WHERE f.code = ?1 AND o.product_sku = ?2
         LIMIT 1`,
        [orderInput.factoryCode, orderInput.productSku],
      );

      if (existing.length > 0) {
        createdOrders.push(existing[0]);
        continue;
      }

      createdOrders.push(await createOrder(orderInput));
    }

    return {
      factories: seededFactories,
      orders: createdOrders,
    };
  },
  name: "seedFactoryData",
});

export { seedFactoryData };
