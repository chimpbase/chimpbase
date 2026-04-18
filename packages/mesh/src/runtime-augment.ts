import type { ChimpbaseMeshClient } from "./types.ts";

declare module "@chimpbase/runtime" {
  interface ChimpbaseContext {
    mesh?: ChimpbaseMeshClient;
  }
}

export {};
