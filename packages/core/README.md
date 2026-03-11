# @chimpbase/core

Low-level engine and registry package for Chimpbase.

This package contains the execution engine, registry contracts and host-facing internals used by `@chimpbase/bun`.

Most application code should use `@chimpbase/runtime` and a host package such as `@chimpbase/bun` instead of importing `@chimpbase/core` directly.

## What is here

- engine execution model
- host registration contracts
- action, listener, queue and workflow orchestration internals

## 0.1.0 distribution model

`@chimpbase/core` is published as TypeScript source for the alpha release.

That keeps the package small and aligned with the Bun-first runtime while the multi-host build pipeline is still evolving.
