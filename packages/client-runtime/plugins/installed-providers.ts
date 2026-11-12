import { pluginContract } from "@t3tools/contracts";
import { tiximClient } from "@t3tools/plugin-tixim-provider/client";
export const pluginProviderClients = pluginContract.enabled ? ([tiximClient] as const) : [];
