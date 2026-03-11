import type { ChimpbaseContext } from "@chimpbase/runtime";
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

const listWorkspacePreferences = async (
  ctx: ChimpbaseContext,
): Promise<TodoPreferenceRecord[]> => {
  return await Promise.all(
    (await ctx.kv.list({ prefix: "workspace." })).map(async (key) => ({
      key,
      value: await ctx.kv.get(key),
    })),
  );
};

const setWorkspacePreference = async (
  ctx: ChimpbaseContext,
  key: string,
  value: unknown,
): Promise<TodoPreferenceRecord> => {
  const normalizedKey = `workspace.${key.trim()}`;
  await ctx.kv.set(normalizedKey, value);
  return {
    key: normalizedKey,
    value: await ctx.kv.get(normalizedKey),
  };
};

const addTodoNote = async (
  ctx: ChimpbaseContext,
  input: TodoNoteInput,
): Promise<TodoNoteRecord> => {
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
};

const listTodoNotes = async (
  ctx: ChimpbaseContext,
  todoId: number,
): Promise<TodoNoteRecord[]> => {
  return await ctx.collection.find<TodoNoteRecord>("todo_notes", { todoId }, { limit: 100 });
};

const listTodoActivityStream = async (
  ctx: ChimpbaseContext,
  input: StreamReadInput = {},
): Promise<TodoActivityStreamEvent[]> => {
  return await ctx.stream.read<TodoActivityStreamEvent["payload"]>(
    input.stream ?? "todo.activity",
    {
      limit: input.limit ?? 100,
      sinceId: input.sinceId ?? 0,
    },
  ) as TodoActivityStreamEvent[];
};

export {
  addTodoNote,
  listTodoActivityStream,
  listTodoNotes,
  listWorkspacePreferences,
  setWorkspacePreference,
};
