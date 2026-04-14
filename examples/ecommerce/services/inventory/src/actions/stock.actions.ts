import { action, type ChimpbaseContext } from "@chimpbase/runtime";

const STOCK_COLLECTION = "stock_items";
const RESERVATIONS_COLLECTION = "reservations";

export interface StockItemRecord {
  id: string;
  sku: string;
  quantity: number;
  reservedQuantity: number;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationRecord {
  id: string;
  orderId: string;
  sku: string;
  quantity: number;
  status: string;
  expiresAt: string;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const setStock = action(
  "setStock",
  async (
    ctx: ChimpbaseContext,
    input: { sku: string; quantity: number; lowStockThreshold?: number },
  ) => {
    const now = nowIso();
    const existing = await ctx.collection.findOne<StockItemRecord>(STOCK_COLLECTION, { sku: input.sku });

    if (existing) {
      await ctx.collection.update(STOCK_COLLECTION, { sku: input.sku }, {
        quantity: input.quantity,
        lowStockThreshold: input.lowStockThreshold ?? existing.lowStockThreshold,
        updatedAt: now,
      });
    } else {
      await ctx.collection.insert(STOCK_COLLECTION, {
        sku: input.sku,
        quantity: input.quantity,
        reservedQuantity: 0,
        lowStockThreshold: input.lowStockThreshold ?? 10,
        createdAt: now,
        updatedAt: now,
      });
    }

    const stock = await ctx.collection.findOne<StockItemRecord>(STOCK_COLLECTION, { sku: input.sku });
    ctx.log.info("stock set", { sku: input.sku, quantity: input.quantity });
    ctx.metric("inventory.stock_set", 1, { sku: input.sku });
    return stock;
  },
);

export const getStock = action(
  "getStock",
  async (ctx: ChimpbaseContext, sku: string) => {
    const stock = await ctx.collection.findOne<StockItemRecord>(STOCK_COLLECTION, { sku });
    if (!stock) return null;
    return {
      ...stock,
      availableQuantity: stock.quantity - stock.reservedQuantity,
    };
  },
);

export const reserveStock = action(
  "reserveStock",
  async (
    ctx: ChimpbaseContext,
    input: { orderId: string; sku: string; quantity: number },
  ) => {
    const stock = await ctx.collection.findOne<StockItemRecord>(STOCK_COLLECTION, { sku: input.sku });
    if (!stock) {
      throw new Error(`Stock not found for SKU: ${input.sku}`);
    }

    const available = stock.quantity - stock.reservedQuantity;
    if (available < input.quantity) {
      throw new Error(`Insufficient stock for SKU ${input.sku}: available=${available}, requested=${input.quantity}`);
    }

    const now = nowIso();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

    const reservationId = await ctx.collection.insert(RESERVATIONS_COLLECTION, {
      orderId: input.orderId,
      sku: input.sku,
      quantity: input.quantity,
      status: "active",
      expiresAt,
      createdAt: now,
    });

    await ctx.collection.update(STOCK_COLLECTION, { sku: input.sku }, {
      reservedQuantity: stock.reservedQuantity + input.quantity,
      updatedAt: now,
    });

    const reservation = await ctx.collection.findOne<ReservationRecord>(RESERVATIONS_COLLECTION, { id: reservationId });
    ctx.pubsub.publish("stock.reserved", reservation);
    ctx.log.info("stock reserved", { sku: input.sku, quantity: input.quantity, orderId: input.orderId });
    ctx.metric("inventory.reserved", input.quantity, { sku: input.sku });
    return reservation;
  },
);

export const releaseReservation = action(
  "releaseReservation",
  async (ctx: ChimpbaseContext, reservationId: string) => {
    const reservation = await ctx.collection.findOne<ReservationRecord>(RESERVATIONS_COLLECTION, { id: reservationId });
    if (!reservation || reservation.status !== "active") return null;

    const stock = await ctx.collection.findOne<StockItemRecord>(STOCK_COLLECTION, { sku: reservation.sku });
    if (!stock) return null;

    await ctx.collection.update(RESERVATIONS_COLLECTION, { id: reservationId }, { status: "released" });
    await ctx.collection.update(STOCK_COLLECTION, { sku: reservation.sku }, {
      reservedQuantity: Math.max(0, stock.reservedQuantity - reservation.quantity),
      updatedAt: nowIso(),
    });

    ctx.pubsub.publish("stock.released", { reservationId, sku: reservation.sku, quantity: reservation.quantity });
    ctx.log.info("reservation released", { reservationId, sku: reservation.sku });
    return { released: true };
  },
);

export const confirmReservation = action(
  "confirmReservation",
  async (ctx: ChimpbaseContext, reservationId: string) => {
    const reservation = await ctx.collection.findOne<ReservationRecord>(RESERVATIONS_COLLECTION, { id: reservationId });
    if (!reservation || reservation.status !== "active") return null;

    const stock = await ctx.collection.findOne<StockItemRecord>(STOCK_COLLECTION, { sku: reservation.sku });
    if (!stock) return null;

    await ctx.collection.update(RESERVATIONS_COLLECTION, { id: reservationId }, { status: "confirmed" });
    await ctx.collection.update(STOCK_COLLECTION, { sku: reservation.sku }, {
      quantity: stock.quantity - reservation.quantity,
      reservedQuantity: Math.max(0, stock.reservedQuantity - reservation.quantity),
      updatedAt: nowIso(),
    });

    ctx.pubsub.publish("stock.confirmed", { reservationId, sku: reservation.sku, quantity: reservation.quantity });
    ctx.log.info("reservation confirmed", { reservationId, sku: reservation.sku });
    ctx.metric("inventory.confirmed", reservation.quantity, { sku: reservation.sku });
    return { confirmed: true };
  },
);
