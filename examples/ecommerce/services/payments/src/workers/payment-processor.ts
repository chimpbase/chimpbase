import type { ChimpbaseContext, ChimpbaseDlqEnvelope } from "@chimpbase/runtime";
import type { PaymentRecord } from "../actions/payment.actions.ts";

const PAYMENTS_COLLECTION = "payments";

function nowIso(): string {
  return new Date().toISOString();
}

export async function processPayment(
  ctx: ChimpbaseContext,
  payload: { paymentId: string },
): Promise<void> {
  const payment = await ctx.collection.findOne<PaymentRecord>(PAYMENTS_COLLECTION, { id: payload.paymentId });
  if (!payment || payment.status !== "pending") {
    ctx.log.warn("payment not found or not pending", { paymentId: payload.paymentId });
    return;
  }

  // Mark as processing
  await ctx.collection.update(PAYMENTS_COLLECTION, { id: payment.id }, {
    status: "processing",
    updatedAt: nowIso(),
  });

  ctx.log.info("processing payment", { paymentId: payment.id, amount: payment.amount });

  // Simulate processing delay
  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

  // 80% success rate
  const succeeded = Math.random() < 0.8;
  const status = succeeded ? "succeeded" : "failed";
  const failureReason = succeeded ? null : "Payment declined by mock provider";

  await ctx.collection.update(PAYMENTS_COLLECTION, { id: payment.id }, {
    status,
    failureReason,
    updatedAt: nowIso(),
  });

  ctx.log.info("payment processed", { paymentId: payment.id, status });
  ctx.metric("payment.processed", 1, { status });

  // Deliver callback to Orders service
  const callbackSecret = ctx.secret("ORDERS_CALLBACK_SECRET");
  try {
    const res = await fetch(payment.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(callbackSecret ? { "x-service-token": callbackSecret } : {}),
      },
      body: JSON.stringify({
        paymentId: payment.id,
        orderId: payment.orderId,
        status,
        failureReason,
      }),
    });

    if (!res.ok) {
      ctx.log.error("payment callback delivery failed", {
        paymentId: payment.id,
        callbackUrl: payment.callbackUrl,
        statusCode: res.status,
      });
      throw new Error(`Callback delivery failed: ${res.status}`);
    }

    ctx.log.info("payment callback delivered", { paymentId: payment.id, orderId: payment.orderId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    ctx.log.error("payment callback delivery error", { paymentId: payment.id, error: message });
    throw err; // Let the worker retry
  }
}

export async function handlePaymentProcessorDlq(
  ctx: ChimpbaseContext,
  envelope: ChimpbaseDlqEnvelope<{ paymentId: string }>,
): Promise<void> {
  ctx.log.error("payment processing exhausted retries", {
    paymentId: envelope.payload.paymentId,
    attempts: envelope.attempts,
    lastError: envelope.lastError,
  });
  ctx.metric("payment.dlq", 1);
}
