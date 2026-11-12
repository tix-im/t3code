// @effect-diagnostics nodeBuiltinImport:off - Reads this package's own source synchronously.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

// A sandboxed preload that requires anything else throws before exposing desktopBridge.
const SANDBOX_RESOLVABLE = new Set(["electron"]);
// vite.config.ts inlines these into the preload bundle.
const BUNDLED_PREFIXES = ["@clerk/electron"];

const VALUE_IMPORT = /^(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;

function externalImports(file: string, seen = new Set<string>()): ReadonlyArray<string> {
  if (seen.has(file)) return [];
  seen.add(file);
  return [...NodeFS.readFileSync(file, "utf8").matchAll(VALUE_IMPORT)].flatMap((match) => {
    const specifier = match[1] ?? "";
    return specifier.startsWith(".")
      ? externalImports(NodePath.resolve(NodePath.dirname(file), specifier), seen)
      : [specifier];
  });
}

it("loads only what a sandboxed preload can resolve", () => {
  const unresolvable = externalImports(NodePath.join(import.meta.dirname, "preload.ts")).filter(
    (specifier) =>
      !SANDBOX_RESOLVABLE.has(specifier) &&
      !BUNDLED_PREFIXES.some((prefix) => specifier.startsWith(prefix)),
  );
  assert.deepEqual(unresolvable, []);
});
