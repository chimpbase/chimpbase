import type { ChimpbaseContext } from "@chimpbase/runtime";

export interface PimProduct {
  id: string;
  sku: string;
  name: string;
  price: number;
  currency: string;
  active: boolean;
}

export async function getProductBySku(ctx: ChimpbaseContext, sku: string): Promise<PimProduct | null> {
  const baseUrl = ctx.secret("PIM_SERVICE_URL");
  if (!baseUrl) throw new Error("PIM_SERVICE_URL secret not configured");

  const res = await fetch(`${baseUrl}/products/sku/${encodeURIComponent(sku)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PIM service error: ${res.status}`);
  return await res.json();
}
