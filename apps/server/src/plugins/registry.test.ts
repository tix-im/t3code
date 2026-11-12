import { expect, it } from "vite-plus/test";
import { mergeContributions, mergeMigrations } from "./registry.ts";

it("rejects contribution collisions instead of replacing a registered handler", () => {
  expect(mergeContributions()).toEqual({});
  expect(mergeContributions({ first: 1 }, { second: 2 })).toEqual({ first: 1, second: 2 });
  expect(() => mergeContributions({ first: 1 }, { first: 2 })).toThrow(
    "Duplicate plugin contribution",
  );
});

it("preserves migration identity and ordering while rejecting duplicate ids and names", () => {
  const legacy = [73, "LegacyPlugin", "legacy"] as const;
  const core = [72, "Core", "core"] as const;
  expect(mergeMigrations([legacy], [core])).toEqual([core, legacy]);
  expect(mergeMigrations()).toEqual([]);
  expect(() => mergeMigrations([legacy], [[73, "Other", null]])).toThrow(
    "Conflicting plugin migration",
  );
  expect(() => mergeMigrations([legacy], [[74, "LegacyPlugin", null]])).toThrow(
    "Conflicting plugin migration",
  );
  expect(() => mergeMigrations([[0, "Invalid", null]])).toThrow("Conflicting plugin migration");
});
