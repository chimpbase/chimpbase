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

const allowedPortableImports = [
  {
    file: "packages/runtime/index.ts",
    label: "node builtins",
    pattern: /\bfrom\s+["']node:async_hooks["']/,
  },
] as const;

describe("portable package guards", () => {
  for (const packageName of ["core", "runtime", "postgres"] as const) {
    test(`@chimpbase/${packageName} stays free of host-specific APIs`, async () => {
      const packageDir = resolve(repoRoot, "packages", packageName);
      const files = await listTypescriptFiles(packageDir);
      const violations: string[] = [];

      for (const file of files) {
        const source = stripComments(await readFile(file, "utf8"));

        for (const check of bannedChecks) {
          if (
            check.pattern.test(source)
            && !isAllowedPortableImport(relative(repoRoot, file), check.label, source)
          ) {
            violations.push(`${relative(repoRoot, file)}: found ${check.label}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }

  test("@chimpbase/deno stays free of Bun globals", async () => {
    const packageDir = resolve(repoRoot, "packages", "deno");
    const files = await listTypescriptFiles(packageDir);
    const violations: string[] = [];

    for (const file of files) {
      const source = stripComments(await readFile(file, "utf8"));
      if (/\bBun\b/.test(source)) {
        violations.push(`${relative(repoRoot, file)}: found Bun global`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("@chimpbase/core publishes the internal files its entrypoint imports", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, "packages/core/package.json"), "utf8"),
    ) as { files?: string[] };

    expect(manifest.files).toEqual([
      "*.ts",
      "README.md",
      "LICENSE",
      "NOTICE",
    ]);
  });

  test("published packages do not use workspace protocol for internal runtime dependencies", async () => {
    const packageDirs = ["bun", "core", "deno", "postgres", "runtime", "tooling"] as const;
    const violations: string[] = [];

    for (const packageName of packageDirs) {
      const manifest = JSON.parse(
        await readFile(resolve(repoRoot, `packages/${packageName}/package.json`), "utf8"),
      ) as { dependencies?: Record<string, string> };

      for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
        if (dependency.startsWith("@chimpbase/") && version.startsWith("workspace:")) {
          violations.push(`packages/${packageName}/package.json: ${dependency} -> ${version}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

function isAllowedPortableImport(relativePath: string, label: string, source: string): boolean {
  return allowedPortableImports.some((entry) =>
    entry.file === relativePath
    && entry.label === label
    && entry.pattern.test(source)
  );
}

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
