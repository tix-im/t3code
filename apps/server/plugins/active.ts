import { pluginContract } from "@t3tools/contracts";

export const pluginActive = pluginContract.enabled && pluginContract.serverSwitchOn(process.env);
