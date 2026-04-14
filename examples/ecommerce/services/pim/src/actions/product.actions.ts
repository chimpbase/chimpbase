import { action, type ChimpbaseContext } from "@chimpbase/runtime";

const PRODUCTS_COLLECTION = "products";

export interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  categoryId: string | null;
  attributes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const createProduct = action(
  "createProduct",
  async (
    ctx: ChimpbaseContext,
    input: {
      sku: string;
      name: string;
      description?: string;
      price: number;
      currency?: string;
      categoryId?: string;
      attributes?: Record<string, unknown>;
      active?: boolean;
    },
  ) => {
    const now = nowIso();
    const id = await ctx.collection.insert(PRODUCTS_COLLECTION, {
      sku: input.sku,
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      currency: input.currency ?? "USD",
      categoryId: input.categoryId ?? null,
      attributes: JSON.stringify(input.attributes ?? {}),
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    });

    const product = await ctx.collection.findOne<ProductRecord>(PRODUCTS_COLLECTION, { id });
    ctx.pubsub.publish("product.created", product);
    ctx.log.info("product created", { productId: id, sku: input.sku });
    ctx.metric("product.created", 1, { sku: input.sku });
    return product;
  },
);

export const updateProduct = action(
  "updateProduct",
  async (
    ctx: ChimpbaseContext,
    input: {
      id: string;
      sku?: string;
      name?: string;
      description?: string;
      price?: number;
      currency?: string;
      categoryId?: string | null;
      attributes?: Record<string, unknown>;
      active?: boolean;
    },
  ) => {
    const existing = await ctx.collection.findOne<ProductRecord>(PRODUCTS_COLLECTION, { id: input.id });
    if (!existing) return null;

    const patch: Record<string, unknown> = { updatedAt: nowIso() };
    if (input.sku !== undefined) patch.sku = input.sku;
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.price !== undefined) patch.price = input.price;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.attributes !== undefined) patch.attributes = JSON.stringify(input.attributes);
    if (input.active !== undefined) patch.active = input.active;

    await ctx.collection.update(PRODUCTS_COLLECTION, { id: input.id }, patch);
    const updated = await ctx.collection.findOne<ProductRecord>(PRODUCTS_COLLECTION, { id: input.id });
    ctx.pubsub.publish("product.updated", updated);
    ctx.log.info("product updated", { productId: input.id });
    return updated;
  },
);

export const getProduct = action("getProduct", async (ctx: ChimpbaseContext, id: string) => {
  return await ctx.collection.findOne<ProductRecord>(PRODUCTS_COLLECTION, { id });
});

export const listProducts = action(
  "listProducts",
  async (ctx: ChimpbaseContext, input?: { categoryId?: string; active?: boolean }) => {
    const filter: Record<string, unknown> = {};
    if (input?.categoryId) filter.categoryId = input.categoryId;
    if (input?.active !== undefined) filter.active = input.active;
    return await ctx.collection.find<ProductRecord>(PRODUCTS_COLLECTION, filter);
  },
);

export const getProductBySku = action(
  "getProductBySku",
  async (ctx: ChimpbaseContext, sku: string) => {
    return await ctx.collection.findOne<ProductRecord>(PRODUCTS_COLLECTION, { sku });
  },
);
