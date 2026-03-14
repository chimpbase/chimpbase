import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function installLocalPackage(
  projectDir: string,
  packageName: string,
  sourceRoot: string,
  entrypoint = "index.ts",
): Promise<void> {
  const packageDir = resolve(projectDir, "node_modules", ...packageName.split("/"));
  await mkdir(dirname(packageDir), { recursive: true });
  await cp(sourceRoot, packageDir, { recursive: true });
  await pointLocalPackageExportsToSource(packageDir, entrypoint);
}

async function pointLocalPackageExportsToSource(packageDir: string, entrypoint: string): Promise<void> {
  const packageJsonPath = resolve(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    exports?: unknown;
  };
  const sourcePath = `./${entrypoint}`;

  packageJson.exports = {
    ".": {
      types: sourcePath,
      import: sourcePath,
      default: sourcePath,
    },
  };

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
