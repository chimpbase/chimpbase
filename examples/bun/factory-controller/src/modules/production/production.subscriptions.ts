import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { ProductionOrderRecord } from "./production.types.ts";

function registerOrderAuditSubscription(eventName: string) {
  return async (
    ctx: ChimpbaseContext,
    order: ProductionOrderRecord,
  ): Promise<void> => {
    await ctx.db.query(
      `INSERT INTO order_audit_log (
         event_name, order_id, factory_code, product_sku, status, operator_email
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      [
        eventName,
        order.id,
        order.factory_code,
        order.product_sku,
        order.status,
        order.operator_email,
      ],
    );

    await ctx.stream.append("production.activity", eventName, {
      factoryCode: order.factory_code,
      operatorEmail: order.operator_email,
      orderId: order.id,
      productSku: order.product_sku,
      status: order.status,
    });
  };
}

const auditOrderCreated = registerOrderAuditSubscription("order.created");
const auditOrderAssigned = registerOrderAuditSubscription("order.assigned");
const auditOrderStarted = registerOrderAuditSubscription("order.started");
const auditOrderQualityCheck = registerOrderAuditSubscription("order.quality_check");
const auditOrderCompleted = registerOrderAuditSubscription("order.completed");
const auditOrderRejected = registerOrderAuditSubscription("order.rejected");

const enqueueOrderCompletedNotification = async (
  ctx: ChimpbaseContext,
  order: ProductionOrderRecord,
): Promise<void> => {
  await ctx.queue.enqueue("order.completed.notify", order);
};

const enqueueOrderRejectedAlert = async (
  ctx: ChimpbaseContext,
  order: ProductionOrderRecord & { rejectionReason?: string },
): Promise<void> => {
  await ctx.queue.enqueue("order.rejected.alert", order);
};

export {
  auditOrderAssigned,
  auditOrderCompleted,
  auditOrderCreated,
  auditOrderQualityCheck,
  auditOrderRejected,
  auditOrderStarted,
  enqueueOrderCompletedNotification,
  enqueueOrderRejectedAlert,
};
