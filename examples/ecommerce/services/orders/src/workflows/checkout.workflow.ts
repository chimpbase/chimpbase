import { workflow } from "@chimpbase/runtime";

interface CheckoutState {
  orderId: string;
  phase: string;
  reservationIds: string[];
  paymentId: string | null;
  error: string | null;
}

export const checkoutWorkflow = workflow({
  name: "order.checkout",
  version: 1,
  initialState: (input: { orderId: string }): CheckoutState => ({
    orderId: input.orderId,
    phase: "validating",
    reservationIds: [],
    paymentId: null,
    error: null,
  }),
  async run(wf) {
    switch (wf.state.phase) {
      // ── Phase 1: Validate items exist in PIM ──────────────────────
      case "validating": {
        const result = await wf.action("validateOrderItems", wf.state.orderId) as {
          valid: boolean;
          error?: string;
          totalAmount?: number;
        };

        if (!result.valid) {
          await wf.action("failOrder", { orderId: wf.state.orderId, reason: result.error ?? "validation failed" });
          return wf.complete({ ...wf.state, phase: "failed", error: result.error ?? "validation failed" });
        }

        return wf.transition({ ...wf.state, phase: "reserving_stock" });
      }

      // ── Phase 2: Reserve stock in Inventory ───────────────────────
      case "reserving_stock": {
        const result = await wf.action("reserveOrderStock", wf.state.orderId) as {
          success: boolean;
          reservationIds: string[];
          error?: string;
        };

        if (!result.success) {
          await wf.action("failOrder", { orderId: wf.state.orderId, reason: result.error ?? "insufficient stock" });
          return wf.complete({ ...wf.state, phase: "failed", error: result.error ?? "insufficient stock" });
        }

        return wf.transition({
          ...wf.state,
          phase: "awaiting_payment",
          reservationIds: result.reservationIds,
        });
      }

      // ── Phase 3: Initiate payment and wait for callback ───────────
      case "awaiting_payment": {
        const paymentResult = await wf.action("requestPayment", wf.state.orderId) as {
          paymentId: string;
        };

        return wf.waitForSignal("payment.result", {
          state: {
            ...wf.state,
            phase: "payment_pending",
            paymentId: paymentResult.paymentId,
          },
          timeoutMs: 15 * 60 * 1000, // 15 minutes
          onSignal: ({ state, payload }) => {
            const p = payload as { status: string; failureReason?: string | null };
            return {
              ...state,
              phase: p.status === "succeeded" ? "payment_succeeded" : "payment_failed",
              error: p.failureReason ?? null,
            };
          },
          onTimeout: ({ state }) => ({
            ...state,
            phase: "payment_timeout",
          }),
        });
      }

      // ── Phase 4a: Payment succeeded -> confirm stock, complete ────
      case "payment_succeeded": {
        await wf.action("confirmOrderStock", wf.state.orderId);
        await wf.action("completeOrder", wf.state.orderId);
        return wf.complete({ ...wf.state, phase: "completed" });
      }

      // ── Phase 4b: Payment failed/timeout -> release stock, fail ───
      case "payment_failed":
      case "payment_timeout": {
        await wf.action("releaseOrderStock", wf.state.orderId);
        const reason = wf.state.phase === "payment_timeout"
          ? "payment timeout"
          : wf.state.error ?? "payment failed";
        await wf.action("failOrder", { orderId: wf.state.orderId, reason });
        return wf.complete({ ...wf.state, phase: "failed", error: reason });
      }

      default:
        return wf.fail(`unknown phase: ${wf.state.phase}`);
    }
  },
});
