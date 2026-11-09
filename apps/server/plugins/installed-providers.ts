import { TiximDriver } from "@t3tools/plugin-tixim-provider/server";
import { pluginActive } from "./active.ts";
export const pluginProviderDrivers = pluginActive ? ([TiximDriver] as const) : [];
