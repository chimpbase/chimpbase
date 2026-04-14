import type {
  ChimpbaseContext,
  ChimpbaseDlqEnvelope,
} from "@chimpbase/runtime";
import type { ProductionOrderRecord } from "./production.types.ts";

const DEFAULT_SENDER = "noreply@factory.chimpbase.dev";

const notifyOrderCompleted = async (
  ctx: ChimpbaseContext,
  order: ProductionOrderRecord,
): Promise<void> => {
  await ctx.trace("order.completed.notify", async (span) => {
    const senderEmail = ctx.secret("FACTORY_NOTIFIER_SENDER") ?? DEFAULT_SENDER;
    span.setAttribute("queue", "order.completed.notify");
    span.setAttribute("order.id", order.id);
    span.setAttribute("factory.code", order.factory_code);

    ctx.log.info("processing order completion notification", {
      factoryCode: order.factory_code,
      orderId: order.id,
      queue: "order.completed.notify",
      senderEmail,
    });
    ctx.metric("order.notifications.delivered", 1, {
      factoryCode: order.factory_code,
      queue: "order.completed.notify",
    });

    await ctx.db.query(
      `INSERT INTO order_notifications (
         queue_name, order_id, factory_code, product_sku, recipient_email, sender_email
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      [
        "order.completed.notify",
        order.id,
        order.factory_code,
        order.product_sku,
        order.operator_email,
        senderEmail,
      ],
    );
  }, {
    queue: "order.completed.notify",
  });
};

const alertOrderRejected = async (
  ctx: ChimpbaseContext,
  order: ProductionOrderRecord & { rejectionReason?: string },
): Promise<void> => {
  await ctx.trace("order.rejected.alert", async (span) => {
    const senderEmail = ctx.secret("FACTORY_NOTIFIER_SENDER") ?? DEFAULT_SENDER;
    span.setAttribute("queue", "order.rejected.alert");
    span.setAttribute("order.id", order.id);
    span.setAttribute("factory.code", order.factory_code);

    ctx.log.info("processing order rejection alert", {
      factoryCode: order.factory_code,
      orderId: order.id,
      queue: "order.rejected.alert",
      reason: order.rejectionReason ?? "",
    });
    ctx.metric("order.rejections.alerted", 1, {
      factoryCode: order.factory_code,
      queue: "order.rejected.alert",
    });

    await ctx.db.query(
      `INSERT INTO order_notifications (
         queue_name, order_id, factory_code, product_sku, recipient_email, sender_email
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      [
        "order.rejected.alert",
        order.id,
        order.factory_code,
        order.product_sku,
        order.operator_email,
        senderEmail,
      ],
    );
  }, {
    queue: "order.rejected.alert",
  });
};

const captureOrderCompletedDlq = async (
  ctx: ChimpbaseContext,
  envelope: ChimpbaseDlqEnvelope<ProductionOrderRecord>,
): Promise<void> => {
  ctx.log.error("order completion notification moved to DLQ", {
    attempts: envelope.attempts,
    orderId: envelope.payload.id,
    queue: envelope.queue,
  });
};

const captureOrderRejectedDlq = async (
  ctx: ChimpbaseContext,
  envelope: ChimpbaseDlqEnvelope<ProductionOrderRecord>,
): Promise<void> => {
  ctx.log.error("order rejection alert moved to DLQ", {
    attempts: envelope.attempts,
    orderId: envelope.payload.id,
    queue: envelope.queue,
  });
};

export {
  alertOrderRejected,
  captureOrderCompletedDlq,
  captureOrderRejectedDlq,
  notifyOrderCompleted,
};
