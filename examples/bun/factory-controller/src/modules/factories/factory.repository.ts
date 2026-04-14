import type { ChimpbaseContext } from "@chimpbase/runtime";
import type { FactoryRecord } from "./factory.types.ts";

export async function listFactories(ctx: ChimpbaseContext): Promise<FactoryRecord[]> {
  return await ctx.db.query<FactoryRecord>("SELECT * FROM factories ORDER BY name");
}

export async function findFactoryByCode(ctx: ChimpbaseContext, code: string): Promise<FactoryRecord | undefined> {
  const rows = await ctx.db.query<FactoryRecord>(
    "SELECT * FROM factories WHERE code = ?1 LIMIT 1",
    [code],
  );
  return rows[0];
}

export async function requireFactoryByCode(ctx: ChimpbaseContext, code: string): Promise<FactoryRecord> {
  const factory = await findFactoryByCode(ctx, code);
  if (!factory) {
    throw new Error(`factory not found: ${code}`);
  }
  return factory;
}

export async function insertFactory(
  ctx: ChimpbaseContext,
  code: string,
  name: string,
  managerEmail: string,
): Promise<FactoryRecord> {
  const [factory] = await ctx.db.query<FactoryRecord>(
    `INSERT INTO factories (code, name, manager_email)
     VALUES (?1, ?2, ?3)
     RETURNING *`,
    [code, name, managerEmail],
  );
  return factory;
}
