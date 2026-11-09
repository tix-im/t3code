import { expect, it } from "@effect/vitest";
import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";
import { vi } from "vite-plus/test";

vi.hoisted(() => {
  process.env.T3CODE_TIXIM = "0";
});
import { pluginStartup } from "./installed.ts";
import { pluginToolkits } from "./installed-mcp.ts";
import { pluginProviderDrivers } from "./installed-providers.ts";
import * as Layer from "effect/Layer";

it("T3CODE_TIXIM=0 removes agent text, tools, driver and worker", () => {
  expect(T3_CODE_ORCHESTRATION_INSTRUCTIONS).not.toContain("Tixim workflows");
  expect(pluginToolkits).toEqual([]);
  expect(pluginProviderDrivers).toEqual([]);
  expect(pluginStartup).toBe(Layer.empty);
});
