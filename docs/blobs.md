# Blobs

Binary object storage for attachments, exports, reports, user uploads. `ctx.blobs` gives S3-like semantics (buckets, keys, metadata, multipart, signed URLs, copy, listing) without the S3 wire protocol.

Two moving parts:

- **Metadata** — stored in Postgres/SQLite alongside the rest of chimpbase state (etag, size, content type, custom metadata).
- **Payload bytes** — stored by a pluggable driver. Ships with a filesystem driver (default) and an in-memory driver (for tests).

## Configure

```ts
import { createChimpbase } from "@chimpbase/bun";
import { chimpbaseBlobs, fsBlobDriver } from "@chimpbase/blobs";

const { signer, registrations } = chimpbaseBlobs({
  secret: process.env.BLOBS_SIGNING_SECRET!,
  baseUrl: "https://api.example.com",
});

const chimpbase = await createChimpbase({
  project: { name: "attachments" },
  blobs: {
    driver: fsBlobDriver({ root: "/var/chimpbase/blobs" }),
    buckets: ["uploads", "exports"],
    signer,
  },
  registrations: [...registrations],
});
```

Buckets are declared up front. They are created lazily on first use. The signer is optional — pass it if you want `ctx.blobs.sign(...)` to work.

## Put / Get / Head / Delete

```ts
await ctx.blobs.put("uploads", "photos/cat.jpg", bytes, {
  contentType: "image/jpeg",
  metadata: { uploader: "alice" },
});

const object = await ctx.blobs.get("uploads", "photos/cat.jpg");
if (object) {
  const bytes = await new Response(object.body).arrayBuffer();
}

const info = await ctx.blobs.head("uploads", "photos/cat.jpg");
await ctx.blobs.delete("uploads", "photos/cat.jpg");
```

Preconditions:

```ts
await ctx.blobs.put("uploads", "photos/cat.jpg", bytes, { ifNoneMatch: "*" });
await ctx.blobs.put("uploads", "photos/cat.jpg", bytes, { ifMatch: previousEtag });
```

Partial reads:

```ts
await ctx.blobs.get("uploads", "video.mp4", { range: { start: 0, end: 1023 } });
```

## List

```ts
const { entries, commonPrefixes, nextCursor } = await ctx.blobs.list("uploads", {
  prefix: "photos/",
  delimiter: "/",
  limit: 100,
});
```

`commonPrefixes` gives you folder-like grouping when `delimiter` is set. Use `nextCursor` for pagination.

## Copy and batch delete

```ts
await ctx.blobs.copy(
  { bucket: "uploads", key: "draft.pdf" },
  { bucket: "archive", key: "2026/draft.pdf" },
);

await ctx.blobs.deleteMany("uploads", ["old/a.txt", "old/b.txt"]);
```

## Multipart uploads

For large or resumable uploads:

```ts
const upload = await ctx.blobs.createUpload("uploads", "big.zip", {
  contentType: "application/zip",
});

await upload.writePart(1, chunk1);
await upload.writePart(2, chunk2);
await upload.writePart(3, chunk3);

await upload.complete(); // assembles, records metadata, returns etag
```

Abandoned uploads expire (default 24h) and are garbage-collected by the hourly cron registered by `chimpbaseBlobs()`.

## Signed URLs

HMAC-signed tokens, not SigV4. Short-lived, URL-only credential you can hand to a browser to upload or download without exposing your server:

```ts
const url = ctx.blobs.sign({
  bucket: "uploads",
  key: "photos/cat.jpg",
  op: "get",
  ttlSec: 60,
});
```

The `@chimpbase/blobs` plugin registers the download/upload routes that verify the token.

Signed `PUT` requests that include a `sizeMax` option buffer the whole request body before writing (so the size check can run before the driver is touched). Without `sizeMax`, the body streams through. If you need streaming uploads larger than you can fit in memory, call `ctx.blobs.put` directly from a server-side action rather than routing through a signed URL.

## Filesystem layout (rsync-friendly)

The `fsBlobDriver` writes to:

```
<root>/
  <bucket>/
    objects/
      <2-byte-sha-shard>/
        <urlencoded-key>
  _uploads/
    <upload-id>/
      part-000001
```

This layout is path-addressed (not content-addressed) so `rsync -a --delete <root>/ <backup-root>/` mirrors the logical content verbatim. Run it from a chimpbase `cron(...)` for periodic local backup.

## Drivers

| Driver | Use when |
| --- | --- |
| `fsBlobDriver({ root })` | Default. Local disk. Rsync, nfs, or a block-volume backed directory. |
| `memoryBlobDriver()` | Tests only. |
| custom | Implement `ChimpbaseBlobDriver` from `@chimpbase/core`. |
