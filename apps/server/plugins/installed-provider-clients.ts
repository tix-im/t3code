import { pluginContract } from "@t3tools/contracts";
import { tiximClient } from "@t3tools/plugin-tixim-provider/client";
// Known whenever the plugin is built in, so a policy naming it still loads with T3CODE_TIXIM=0.
export const pluginProviderClients = pluginContract.enabled ? ([tiximClient] as const) : [];
