import type { ChimpbaseContext, ChimpbaseCronInvocation } from "@chimpbase/runtime";
import type { StockItemRecord } from "../actions/stock.actions.ts";

const STOCK_COLLECTION = "stock_items";

export async function checkLowStock(
  ctx: ChimpbaseContext,
  _invocation: ChimpbaseCronInvocation,
): Promise<void> {
  const allStock = await ctx.collection.find<StockItemRecord>(STOCK_COLLECTION, {});

  let alertCount = 0;
  for (const item of allStock) {
    const available = item.quantity - item.reservedQuantity;
    if (available < item.lowStockThreshold) {
      const alertKey = `low-stock-alert:${item.sku}`;
      const alreadyAlerted = await ctx.kv.get<boolean>(alertKey);

      if (!alreadyAlerted) {
        ctx.pubsub.publish("stock.low", {
          sku: item.sku,
          available,
          threshold: item.lowStockThreshold,
        });
        await ctx.kv.set(alertKey, true);
        alertCount++;
        ctx.log.warn("low stock detected", { sku: item.sku, available, threshold: item.lowStockThreshold });
      }
    } else {
      // Clear alert flag when stock is back above threshold
      await ctx.kv.set(`low-stock-alert:${item.sku}`, false);
    }
  }

  if (alertCount > 0) {
    ctx.metric("inventory.low_stock_alerts", alertCount);
  }
}
