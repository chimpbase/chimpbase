import type { ChimpbaseContext } from "@chimpbase/runtime";
import type {
  NormalizedOrderListFilters,
  ProductionDashboard,
  ProductionOrderRecord,
} from "./production.types.ts";

const ORDER_SELECT = `
  SELECT
    o.id,
    o.factory_id,
    f.code AS factory_code,
    f.name AS factory_name,
    o.product_sku,
    o.quantity,
    o.status,
    o.priority,
    o.operator_email,
    o.started_at,
    o.completed_at,
    o.rejected_at,
    o.created_at,
    o.updated_at
  FROM production_orders o
  INNER JOIN factories f ON f.id = o.factory_id
`;

export async function listOrders(
  ctx: ChimpbaseContext,
  filters: NormalizedOrderListFilters,
): Promise<ProductionOrderRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.factoryCode) {
    conditions.push(`f.code = ?${idx++}`);
    params.push(filters.factoryCode);
  }
  if (filters.status) {
    conditions.push(`o.status = ?${idx++}`);
    params.push(filters.status);
  }
  if (filters.priority) {
    conditions.push(`o.priority = ?${idx++}`);
    params.push(filters.priority);
  }
  if (filters.operatorEmail) {
    conditions.push(`o.operator_email = ?${idx++}`);
    params.push(filters.operatorEmail);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return await ctx.db.query<ProductionOrderRecord>(
    `${ORDER_SELECT} ${where} ORDER BY o.created_at DESC`,
    params,
  );
}

export async function findOrderById(
  ctx: ChimpbaseContext,
  id: number,
): Promise<ProductionOrderRecord | undefined> {
  const rows = await ctx.db.query<ProductionOrderRecord>(
    `${ORDER_SELECT} WHERE o.id = ?1 LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function requireOrderById(
  ctx: ChimpbaseContext,
  id: number,
): Promise<ProductionOrderRecord> {
  const order = await findOrderById(ctx, id);
  if (!order) {
    throw new Error(`production order not found: ${id}`);
  }
  return order;
}

export async function insertOrder(
  ctx: ChimpbaseContext,
  factoryId: number,
  input: {
    productSku: string;
    quantity: number;
    priority: string;
    operatorEmail: string | null;
  },
): Promise<ProductionOrderRecord> {
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO production_orders (factory_id, product_sku, quantity, priority, operator_email)
     VALUES (?1, ?2, ?3, ?4, ?5)
     RETURNING id`,
    [factoryId, input.productSku, input.quantity, input.priority, input.operatorEmail],
  );
  return await requireOrderById(ctx, row.id);
}

export async function updateOrderStatus(
  ctx: ChimpbaseContext,
  id: number,
  status: string,
): Promise<ProductionOrderRecord> {
  const extras: string[] = ["updated_at = CAST(CURRENT_TIMESTAMP AS TEXT)"];
  if (status === "in_progress") {
    extras.push("started_at = CAST(CURRENT_TIMESTAMP AS TEXT)");
  } else if (status === "completed") {
    extras.push("completed_at = CAST(CURRENT_TIMESTAMP AS TEXT)");
  } else if (status === "rejected") {
    extras.push("rejected_at = CAST(CURRENT_TIMESTAMP AS TEXT)");
  }

  await ctx.db.query(
    `UPDATE production_orders SET status = ?1, ${extras.join(", ")} WHERE id = ?2`,
    [status, id],
  );
  return await requireOrderById(ctx, id);
}

export async function updateOrderOperator(
  ctx: ChimpbaseContext,
  id: number,
  operatorEmail: string,
): Promise<ProductionOrderRecord> {
  await ctx.db.query(
    `UPDATE production_orders
     SET operator_email = ?1, updated_at = CAST(CURRENT_TIMESTAMP AS TEXT)
     WHERE id = ?2`,
    [operatorEmail, id],
  );
  return await requireOrderById(ctx, id);
}

export async function getProductionDashboard(
  ctx: ChimpbaseContext,
  factoryCode: string | null,
): Promise<ProductionDashboard> {
  const where = factoryCode
    ? "INNER JOIN factories f ON f.id = o.factory_id WHERE f.code = ?1"
    : "";
  const params = factoryCode ? [factoryCode] : [];

  const [row] = await ctx.db.query<ProductionDashboard>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN o.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN o.status = 'quality_check' THEN 1 ELSE 0 END) AS quality_check,
       SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN o.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN o.operator_email IS NOT NULL THEN 1 ELSE 0 END) AS assigned
     FROM production_orders o ${where}`,
    params,
  );

  return {
    total: Number(row.total),
    pending: Number(row.pending),
    in_progress: Number(row.in_progress),
    quality_check: Number(row.quality_check),
    completed: Number(row.completed),
    rejected: Number(row.rejected),
    assigned: Number(row.assigned),
  };
}
