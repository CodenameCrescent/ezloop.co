import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * lib/domain is a PURE package (CLAUDE.md): no Express, React, Drizzle, zod,
 * node built-ins, or any framework — decimal.js and relative imports only.
 * This test enforces that on every `pnpm -r test` run. Test files themselves
 * may use node:test / node:assert / node:fs.
 */
const ALLOWED = new Set(["decimal.js"]);

const srcDir = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

test("domain sources import nothing but decimal.js and relative modules", () => {
  const files = sourceFiles(srcDir);
  assert.ok(files.length > 0, "expected domain source files");
  const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  const violations: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
      if (ALLOWED.has(specifier)) continue;
      violations.push(`${file}: "${specifier}"`);
    }
  }
  assert.deepEqual(violations, [], `impure imports in lib/domain:\n${violations.join("\n")}`);
});
