import { pluginContract } from "@t3tools/contracts";
import { mergeContributions } from "../src/plugins/registry.ts";

export const pluginRpcScopes = mergeContributions(pluginContract.scopes);
export const pluginRpcAggregates = Object.fromEntries(
  Object.values(pluginContract.methods).map((method) => [method, "server" as const]),
) as Record<(typeof pluginContract.methods)[keyof typeof pluginContract.methods], "server">;
