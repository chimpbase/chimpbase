import { action, type ChimpbaseContext, v } from "@chimpbase/runtime";
import type { CreateFactoryInput, FactoryRecord } from "./factory.types.ts";
import {
  findFactoryByCode,
  insertFactory,
  listFactories as listFactoriesFromRepo,
} from "./factory.repository.ts";

function toCode(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

const listFactories = action({
  async handler(ctx: ChimpbaseContext): Promise<FactoryRecord[]> {
    return await listFactoriesFromRepo(ctx);
  },
  name: "listFactories",
});

const createFactory = action({
  args: v.object({
    managerEmail: v.string(),
    name: v.string(),
  }),
  async handler(ctx: ChimpbaseContext, input: CreateFactoryInput): Promise<FactoryRecord> {
    const name = input.name.trim();
    if (!name) throw new Error("factory name is required");

    const email = input.managerEmail.trim().toLowerCase();
    if (!email) throw new Error("managerEmail is required");

    const code = toCode(name);
    const existing = await findFactoryByCode(ctx, code);
    if (existing) return existing;

    return await insertFactory(ctx, code, name, email);
  },
  name: "createFactory",
});

export { createFactory, listFactories };
