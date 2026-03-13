import { action, type ChimpbaseContext, v } from "@chimpbase/runtime";
import type {
  TodoActivityStreamEvent,
  TodoNoteRecord,
  TodoPreferenceRecord,
} from "./todo.types.ts";

interface TodoNoteInput {
  body: string;
  todoId: number;
}

interface StreamReadInput {
  limit?: number;
  sinceId?: number;
  stream?: string;
}

const listWorkspacePreferences = action({
  async handler(
    ctx: ChimpbaseContext,
  ): Promise<TodoPreferenceRecord[]> {
    return await Promise.all(
      (await ctx.kv.list({ prefix: "workspace." })).map(async (key) => ({
        key,
        value: await ctx.kv.get(key),
      })),
    );
  },
  name: "listWorkspacePreferences",
});

const setWorkspacePreference = action({
  args: v.object({
    key: v.string(),
    value: v.unknown(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { key: string; value: unknown },
  ): Promise<TodoPreferenceRecord> {
    const normalizedKey = `workspace.${input.key.trim()}`;
    await ctx.kv.set(normalizedKey, input.value);
    return {
      key: normalizedKey,
      value: await ctx.kv.get(normalizedKey),
    };
  },
  name: "setWorkspacePreference",
});

const addTodoNote = action({
  args: v.object({
    body: v.string(),
    todoId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: TodoNoteInput,
  ): Promise<TodoNoteRecord> {
    const noteId = await ctx.collection.insert("todo_notes", {
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
      todoId: input.todoId,
    });
    const note = await ctx.collection.findOne<TodoNoteRecord>("todo_notes", { id: noteId });
    if (!note) {
      throw new Error("failed to load inserted todo note");
    }

    return note;
  },
  name: "addTodoNote",
});

const listTodoNotes = action({
  args: v.object({
    todoId: v.number(),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: { todoId: number },
  ): Promise<TodoNoteRecord[]> {
    return await ctx.collection.find<TodoNoteRecord>("todo_notes", { todoId: input.todoId }, { limit: 100 });
  },
  name: "listTodoNotes",
});

const listTodoActivityStream = action({
  args: v.object({
    limit: v.optional(v.number()),
    sinceId: v.optional(v.number()),
    stream: v.optional(v.string()),
  }),
  async handler(
    ctx: ChimpbaseContext,
    input: StreamReadInput,
  ): Promise<TodoActivityStreamEvent[]> {
    return await ctx.stream.read<TodoActivityStreamEvent["payload"]>(
      input.stream ?? "todo.activity",
      {
        limit: input.limit ?? 100,
        sinceId: input.sinceId ?? 0,
      },
    ) as TodoActivityStreamEvent[];
  },
  name: "listTodoActivityStream",
});

export {
  addTodoNote,
  listTodoActivityStream,
  listTodoNotes,
  listWorkspacePreferences,
  setWorkspacePreference,
};
