import { pluginContract } from "@t3tools/contracts";
import { TiximDriver } from "@t3tools/plugin-tixim-provider/server";
export const pluginProviderDrivers = pluginContract.enabled ? ([TiximDriver] as const) : [];
