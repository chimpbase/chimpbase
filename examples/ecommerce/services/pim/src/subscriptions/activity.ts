import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { ProductRecord } from "../actions/product.actions.ts";

export async function logProductCreated(ctx: ChimpbaseContext, product: ProductRecord): Promise<void> {
  await ctx.stream.append("pim.activity", "product.created", {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    price: product.price,
  });
}

export async function logProductUpdated(ctx: ChimpbaseContext, product: ProductRecord): Promise<void> {
  await ctx.stream.append("pim.activity", "product.updated", {
    productId: product.id,
    sku: product.sku,
    name: product.name,
  });
}
