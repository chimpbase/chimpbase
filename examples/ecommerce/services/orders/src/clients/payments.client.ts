import type { ChimpbaseContext } from "@chimpbase/runtime";

export interface PaymentResult {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
}

export async function initiatePayment(
  ctx: ChimpbaseContext,
  orderId: string,
  amount: number,
  currency: string,
  callbackUrl: string,
): Promise<PaymentResult> {
  const baseUrl = ctx.secret("PAYMENTS_SERVICE_URL");
  if (!baseUrl) throw new Error("PAYMENTS_SERVICE_URL secret not configured");

  const res = await fetch(`${baseUrl}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, amount, currency, callbackUrl }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `Payment initiation failed: ${res.status}`);
  }
  return await res.json();
}
