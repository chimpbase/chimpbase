import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { ReservationRecord } from "../actions/stock.actions.ts";

export async function logStockReserved(ctx: ChimpbaseContext, reservation: ReservationRecord): Promise<void> {
  await ctx.stream.append("inventory.activity", "stock.reserved", {
    reservationId: reservation.id,
    orderId: reservation.orderId,
    sku: reservation.sku,
    quantity: reservation.quantity,
  });
}

export async function logLowStock(
  ctx: ChimpbaseContext,
  payload: { sku: string; available: number; threshold: number },
): Promise<void> {
  await ctx.stream.append("inventory.activity", "stock.low", {
    sku: payload.sku,
    available: payload.available,
    threshold: payload.threshold,
  });
}
