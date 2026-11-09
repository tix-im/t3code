import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

vi.mock(import("@t3tools/contracts"), async (original) => {
  const contracts = await original();
  return { ...contracts, pluginContract: { ...contracts.pluginContract, enabled: false } };
});
import { pluginStartup } from "./installed.ts";
import { pluginToolkits } from "./installed-mcp.ts";
import { pluginProviderDrivers } from "./installed-providers.ts";
import { pluginMigrationTracks } from "./installed-migrations.ts";
import { WorkflowWaits } from "./tixim/TiximWorkflowWaits.ts";

it.effect(
  "disabled installation starts no wait worker and registers no tools or drivers while retaining migration history",
  () =>
    Effect.gen(function* () {
      const start = vi.fn(() => Effect.die("Disabled plugin must not start"));
      yield* Effect.scoped(Layer.build(pluginStartup)).pipe(
        Effect.provideService(WorkflowWaits, {
          start,
          wait: () => Effect.die("Disabled plugin must not wait"),
          poll: () => Effect.die("Disabled plugin must not poll"),
          sweep: Effect.die("Disabled plugin must not sweep"),
        }),
      );
      expect(start).not.toHaveBeenCalled();
      expect(pluginToolkits).toEqual([]);
      expect(pluginProviderDrivers).toEqual([]);
      expect(
        pluginMigrationTracks.map(({ table, migrations }) => [table, migrations.map(([id]) => id)]),
      ).toEqual([["tixim_sql_migrations", [1, 2, 3, 4]]]);
    }),
);
