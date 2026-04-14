import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { PaymentRecord } from "../actions/payment.actions.ts";

export async function logPaymentRefunded(ctx: ChimpbaseContext, payment: PaymentRecord): Promise<void> {
  await ctx.stream.append("payments.activity", "payment.refunded", {
    paymentId: payment.id,
    orderId: payment.orderId,
    amount: payment.amount,
  });
}
