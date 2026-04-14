import { action, type ChimpbaseContext } from "@chimpbase/runtime";

const PAYMENTS_COLLECTION = "payments";

export interface PaymentRecord {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  callbackUrl: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const initiatePayment = action(
  "initiatePayment",
  async (
    ctx: ChimpbaseContext,
    input: {
      orderId: string;
      amount: number;
      currency: string;
      callbackUrl: string;
    },
  ) => {
    const now = nowIso();
    const id = await ctx.collection.insert(PAYMENTS_COLLECTION, {
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      status: "pending",
      callbackUrl: input.callbackUrl,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    });

    // Enqueue async processing
    await ctx.queue.enqueue("payment.process", { paymentId: id });

    const payment = await ctx.collection.findOne<PaymentRecord>(PAYMENTS_COLLECTION, { id });
    ctx.log.info("payment initiated", { paymentId: id, orderId: input.orderId, amount: input.amount });
    ctx.metric("payment.initiated", 1, { currency: input.currency });
    return payment;
  },
);

export const getPayment = action(
  "getPayment",
  async (ctx: ChimpbaseContext, id: string) => {
    return await ctx.collection.findOne<PaymentRecord>(PAYMENTS_COLLECTION, { id });
  },
);

export const refundPayment = action(
  "refundPayment",
  async (ctx: ChimpbaseContext, id: string) => {
    const payment = await ctx.collection.findOne<PaymentRecord>(PAYMENTS_COLLECTION, { id });
    if (!payment) return null;
    if (payment.status !== "succeeded") {
      throw new Error(`Cannot refund payment in status: ${payment.status}`);
    }

    await ctx.collection.update(PAYMENTS_COLLECTION, { id }, {
      status: "refunded",
      updatedAt: nowIso(),
    });

    const updated = await ctx.collection.findOne<PaymentRecord>(PAYMENTS_COLLECTION, { id });
    ctx.pubsub.publish("payment.refunded", updated);
    ctx.log.info("payment refunded", { paymentId: id, orderId: payment.orderId });
    ctx.metric("payment.refunded", 1);
    return updated;
  },
);
