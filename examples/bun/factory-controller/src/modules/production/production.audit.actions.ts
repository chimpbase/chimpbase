import { action, type ChimpbaseContext } from "@chimpbase/runtime";
import type {
  OrderAuditRecord,
  OrderNotificationRecord,
} from "./production.types.ts";

interface OrderEventRecord {
  id: number;
  event_name: string;
  payload_json: string;
  created_at: string;
}

const listOrderAuditLog = action({
  async handler(ctx: ChimpbaseContext): Promise<OrderAuditRecord[]> {
    return await ctx.db.query<OrderAuditRecord>(
      "SELECT * FROM order_audit_log ORDER BY created_at DESC",
    );
  },
  name: "listOrderAuditLog",
});

const listOrderEvents = action({
  async handler(ctx: ChimpbaseContext): Promise<OrderEventRecord[]> {
    return await ctx.db.query<OrderEventRecord>(
      "SELECT * FROM _chimpbase_events ORDER BY created_at DESC LIMIT 200",
    );
  },
  name: "listOrderEvents",
});

const listOrderNotifications = action({
  async handler(ctx: ChimpbaseContext): Promise<OrderNotificationRecord[]> {
    return await ctx.db.query<OrderNotificationRecord>(
      "SELECT * FROM order_notifications ORDER BY created_at DESC",
    );
  },
  name: "listOrderNotifications",
});

export {
  listOrderAuditLog,
  listOrderEvents,
  listOrderNotifications,
};
