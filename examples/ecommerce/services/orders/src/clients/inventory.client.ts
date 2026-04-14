import type { ChimpbaseContext } from "@chimpbase/runtime";

export interface Reservation {
  id: string;
  orderId: string;
  sku: string;
  quantity: number;
  status: string;
}

export async function reserveStock(
  ctx: ChimpbaseContext,
  orderId: string,
  sku: string,
  quantity: number,
): Promise<Reservation> {
  const baseUrl = ctx.secret("INVENTORY_SERVICE_URL");
  if (!baseUrl) throw new Error("INVENTORY_SERVICE_URL secret not configured");

  const res = await fetch(`${baseUrl}/stock/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, sku, quantity }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `Inventory reserve failed: ${res.status}`);
  }
  return await res.json();
}

export async function releaseReservation(ctx: ChimpbaseContext, reservationId: string): Promise<void> {
  const baseUrl = ctx.secret("INVENTORY_SERVICE_URL");
  if (!baseUrl) throw new Error("INVENTORY_SERVICE_URL secret not configured");

  const res = await fetch(`${baseUrl}/stock/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `Inventory release failed: ${res.status}`);
  }
}

export async function confirmReservation(ctx: ChimpbaseContext, reservationId: string): Promise<void> {
  const baseUrl = ctx.secret("INVENTORY_SERVICE_URL");
  if (!baseUrl) throw new Error("INVENTORY_SERVICE_URL secret not configured");

  const res = await fetch(`${baseUrl}/stock/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `Inventory confirm failed: ${res.status}`);
  }
}
