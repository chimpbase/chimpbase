import { action, type ChimpbaseContext, v } from "@chimpbase/runtime";
import type {
  FactorySettingRecord,
  ProductionActivityStreamEvent,
  QualityReportRecord,
} from "./production.types.ts";

const listFactorySettings = action({
  async handler(ctx: ChimpbaseContext): Promise<FactorySettingRecord[]> {
    return await Promise.all(
      (await ctx.kv.list({ prefix: "factory." })).map(async (key) => ({
        key,
        value: await ctx.kv.get(key),
      })),
    );
  },
  name: "listFactorySettings",
});

const setFactorySetting = action({
  args: v.object({
    key: v.string(),
    value: v.unknown(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { key: string; value: unknown },
  ): Promise<FactorySettingRecord> {
    const normalizedKey = `factory.${input.key.trim()}`;
    await ctx.kv.set(normalizedKey, input.value);
    return {
      key: normalizedKey,
      value: await ctx.kv.get(normalizedKey),
    };
  },
  name: "setFactorySetting",
});

const addQualityReport = action({
  args: v.object({
    inspector: v.string(),
    notes: v.string(),
    orderId: v.number(),
    passed: v.boolean(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { inspector: string; notes: string; orderId: number; passed: boolean },
  ): Promise<QualityReportRecord> {
    const reportId = await ctx.collection.insert("quality_reports", {
      createdAt: new Date().toISOString(),
      inspector: input.inspector.trim(),
      notes: input.notes.trim(),
      orderId: input.orderId,
      passed: input.passed,
    });
    const report = await ctx.collection.findOne<QualityReportRecord>("quality_reports", { id: reportId });
    if (!report) {
      throw new Error("failed to load inserted quality report");
    }
    return report;
  },
  name: "addQualityReport",
});

const listQualityReports = action({
  args: v.object({
    orderId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { orderId: number },
  ): Promise<QualityReportRecord[]> {
    return await ctx.collection.find<QualityReportRecord>(
      "quality_reports",
      { orderId: input.orderId },
      { limit: 100 },
    );
  },
  name: "listQualityReports",
});

const listProductionActivityStream = action({
  args: v.object({
    limit: v.optional(v.number()),
    sinceId: v.optional(v.number()),
    stream: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { limit?: number; sinceId?: number; stream?: string },
  ): Promise<ProductionActivityStreamEvent[]> {
    return await ctx.stream.read<ProductionActivityStreamEvent["payload"]>(
      input.stream ?? "production.activity",
      {
        limit: input.limit ?? 100,
        sinceId: input.sinceId ?? 0,
      },
    ) as ProductionActivityStreamEvent[];
  },
  name: "listProductionActivityStream",
});

export {
  addQualityReport,
  listFactorySettings,
  listProductionActivityStream,
  listQualityReports,
  setFactorySetting,
};
