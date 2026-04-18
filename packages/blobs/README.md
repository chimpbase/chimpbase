# @chimpbase/blobs

Blob storage primitive for Chimpbase. Provides `ctx.blobs` on every chimpbase context plus a filesystem and in-memory driver.

## Install

```bash
bun add @chimpbase/blobs
```

## Usage

```ts
import { createChimpbase } from "@chimpbase/bun";
import { chimpbaseBlobs, fsBlobDriver } from "@chimpbase/blobs";

const { signer, registrations } = chimpbaseBlobs({
  secret: process.env.BLOBS_SIGNING_SECRET!,
  baseUrl: "https://example.com",
});

const chimpbase = await createChimpbase({
  project: { name: "attachments" },
  blobs: {
    driver: fsBlobDriver({ root: "/var/chimpbase/blobs" }),
    buckets: ["uploads"],
    signer,
  },
  registrations: [...registrations],
});
```

Inside any action, worker, cron, subscription, or workflow handler:

```ts
await ctx.blobs.put("uploads", "photos/cat.jpg", bytes, {
  contentType: "image/jpeg",
  metadata: { author: "alice" },
});

const object = await ctx.blobs.get("uploads", "photos/cat.jpg");
await ctx.blobs.list("uploads", { prefix: "photos/" });

const upload = await ctx.blobs.createUpload("uploads", "video.mp4");
await upload.writePart(1, chunk1);
await upload.writePart(2, chunk2);
await upload.complete();
```

## Drivers

- `fsBlobDriver({ root })` — filesystem. Writes to `<root>/<bucket>/objects/...`. Rsync-friendly. Verified on Bun and Node; on Deno it relies on `node:stream/web` through the `node` compatibility layer.
- `memoryBlobDriver()` — in-memory. For tests.

Custom drivers implement the `ChimpbaseBlobDriver` interface from `@chimpbase/core`.
