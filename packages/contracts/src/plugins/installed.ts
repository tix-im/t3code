import * as pluginContract from "@t3tools/plugin-tixim-contracts";

export { pluginContract };
export * from "@t3tools/plugin-tixim-contracts/schemas";

export type { TiximDesktopBridge as PluginDesktopBridge } from "@t3tools/plugin-tixim-contracts/schemas";

export const pluginOrchestrationInstructions = pluginContract.enabled
  ? pluginContract.orchestrationInstructions
  : "";

export type {
  SubscriptionMethod as PluginSubscriptionMethod,
  StreamCommandMethod as PluginStreamCommandMethod,
} from "@t3tools/plugin-tixim-contracts";
