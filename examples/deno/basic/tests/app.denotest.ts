import { assertEquals } from "jsr:@std/assert@1";

import { createChimpbase } from "@chimpbase/deno";

import app from "../chimpbase.app.ts";

async function reservePort(): Promise<number> {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

Deno.test("deno/basic example — creates and lists orders over HTTP", async () => {
  const port = await reservePort();
  const host = await createChimpbase({
    ...app,
    storage: { engine: "memory" },
    server: { port },
  });
  const started = await host.start();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const created = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer: "alice@example.com", amount: 4200 }),
    });
    assertEquals(created.status, 201);
    const createdBody = await created.json() as {
      customer: string;
      amount: number;
    };
    assertEquals(createdBody.customer, "alice@example.com");
    assertEquals(createdBody.amount, 4200);

    const list = await fetch(`${baseUrl}/orders`);
    assertEquals(list.status, 200);
    const rows = await list.json() as Array<{ customer: string }>;
    assertEquals(rows.length, 1);
  } finally {
    await started.stop();
  }
});

Deno.test("deno/basic example — built-in health check", async () => {
  const port = await reservePort();
  const host = await createChimpbase({
    ...app,
    storage: { engine: "memory" },
    server: { port },
  });
  const started = await host.start();

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  } finally {
    await started.stop();
  }
});
