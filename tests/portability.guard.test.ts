import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

const bannedChecks = [
  {
    label: "node builtins",
    pattern: /\bfrom\s+["']node:|\bimport\s*\(\s*["']node:|\brequire\s*\(\s*["']node:/,
  },
  {
    label: "Bun global",
    pattern: /\bBun\b/,
  },
  {
    label: "Deno global",
    pattern: /\bDeno\b/,
  },
  {
    label: "process global",
    pattern: /\bprocess\b/,
  },
] as const;

describe("portable package guards", () => {
  for (const packageName of ["core", "runtime", "postgres"] as const) {
    test(`@chimpbase/${packageName} stays free of host-specific APIs`, async () => {
      const packageDir = resolve(repoRoot, "packages", packageName);
      const files = await listTypescriptFiles(packageDir);
      const violations: string[] = [];

      for (const file of files) {
        const source = await readFile(file, "utf8");

        for (const check of bannedChecks) {
          if (check.pattern.test(source)) {
            violations.push(`${relative(repoRoot, file)}: found ${check.label}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }
});

async function listTypescriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypescriptFiles(path));
      continue;
    }

    if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files.sort();
}
