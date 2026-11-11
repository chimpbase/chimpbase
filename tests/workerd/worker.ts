// Worker entry for the Durable Object SQLite conformance suite. Bundled and run in
// workerd by `scripts/test-workerd.mjs`; each case runs in its own SQLite-backed
// Durable Object instance.
import type { DurableObjectSqliteStorageLike } from "../../packages/cloudflare/src/index.ts";
import { doSqliteCases } from "./do-sqlite.suite.ts";

interface DurableObjectStateLike {
  readonly storage: DurableObjectSqliteStorageLike;
}

interface DurableObjectNamespaceLike {
  get(id: unknown): { fetch(request: Request): Promise<Response> };
  idFromName(name: string): unknown;
}

interface Env {
  DO_SQLITE_SUITE: DurableObjectNamespaceLike;
}

export class ChimpbaseDoSqliteSuite {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const name = new URL(request.url).searchParams.get("case") ?? "";
    const run = Object.hasOwn(doSqliteCases, name) ? doSqliteCases[name] : undefined;
    if (run === undefined) return Response.json({ error: `unknown case: ${name}`, ok: false }, { status: 404 });
    try {
      await run(this.state.storage);
      return Response.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      return Response.json({ error: message, ok: false });
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/cases") return Response.json(Object.keys(doSqliteCases));
    const name = url.searchParams.get("case") ?? "";
    return await env.DO_SQLITE_SUITE.get(env.DO_SQLITE_SUITE.idFromName(name)).fetch(request);
  },
};
