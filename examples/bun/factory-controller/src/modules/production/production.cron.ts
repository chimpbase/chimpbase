import type {
  ChimpbaseContext,
  ChimpbaseCronInvocation,
} from "@chimpbase/runtime";
import { action } from "@chimpbase/runtime";
import type {
  ProductionDashboard,
  ProductionSnapshotRecord,
} from "./production.types.ts";

const captureProductionSnapshot = async (
  ctx: ChimpbaseContext,
  invocation: ChimpbaseCronInvocation,
): Promise<void> => {
  const [summary] = await ctx.db.query<ProductionDashboard>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
       SUM(CASE WHEN status = 'quality_check' THEN 1 ELSE 0 END) AS quality_check,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN operator_email IS NOT NULL THEN 1 ELSE 0 END) AS assigned
     FROM production_orders`,
  );

  const snapshot = {
    capturedAt: invocation.fireAt,
    schedule: invocation.name,
    summary: {
      total: Number(summary.total),
      pending: Number(summary.pending),
      in_progress: Number(summary.in_progress),
      quality_check: Number(summary.quality_check),
      completed: Number(summary.completed),
      rejected: Number(summary.rejected),
      assigned: Number(summary.assigned),
    },
  };

  await ctx.collection.insert("production_snapshots", snapshot);
  await ctx.stream.append("production.ops", "production.snapshot.captured", {
    capturedAt: invocation.fireAt,
    completed: snapshot.summary.completed,
    rejected: snapshot.summary.rejected,
    schedule: invocation.name,
    total: snapshot.summary.total,
  });

  ctx.log.info("captured production snapshot", {
    completed: snapshot.summary.completed,
    rejected: snapshot.summary.rejected,
    schedule: invocation.name,
    total: snapshot.summary.total,
  });
};

const listProductionSnapshots = action({
  async handler(ctx: ChimpbaseContext): Promise<ProductionSnapshotRecord[]> {
    return await ctx.collection.find<ProductionSnapshotRecord>(
      "production_snapshots",
      {},
      { limit: 50 },
    );
  },
  name: "listProductionSnapshots",
});

export {
  captureProductionSnapshot,
  listProductionSnapshots,
};
