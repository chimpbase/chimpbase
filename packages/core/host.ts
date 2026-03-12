export interface ChimpbasePlatformShim {
  hashString(input: string): string;
  now(): number;
  randomUUID(): string;
}

export interface ChimpbaseSecretsSource {
  get(name: string): string | null;
}

export interface ChimpbaseMigration {
  name: string;
  sql: string;
}

export interface ChimpbaseMigrationSource {
  list(): Promise<ChimpbaseMigration[]>;
}

export interface ChimpbaseDrainOptions {
  maxDurationMs?: number;
  maxRuns?: number;
}

export interface ChimpbaseDrainResult {
  cronSchedules: number;
  idle: boolean;
  queueJobs: number;
  runs: number;
  stopReason: "idle" | "max_duration" | "max_runs";
}

const DETERMINISTIC_HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const DETERMINISTIC_HASH_PRIME = 0x100000001b3n;
const textEncoder = new TextEncoder();

export function createDefaultChimpbasePlatformShim(): ChimpbasePlatformShim {
  return {
    hashString(input: string): string {
      return hashDeterministicString(input);
    },
    now(): number {
      return Date.now();
    },
    randomUUID(): string {
      if (typeof globalThis.crypto?.randomUUID !== "function") {
        throw new Error("global crypto.randomUUID is unavailable");
      }

      return globalThis.crypto.randomUUID();
    },
  };
}

function hashDeterministicString(input: string): string {
  let hash = DETERMINISTIC_HASH_OFFSET_BASIS;

  for (const byte of textEncoder.encode(input)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * DETERMINISTIC_HASH_PRIME);
  }

  return hash.toString(16).padStart(16, "0");
}
