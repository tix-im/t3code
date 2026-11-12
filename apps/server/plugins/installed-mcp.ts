import { pluginContract } from "@t3tools/contracts";
import { toolkit } from "./tixim/mcp-tools.ts";
import { layer } from "./tixim/mcp-handlers.ts";

export const pluginToolkits = pluginContract.enabled
  ? ([{ toolkit, handlers: layer }] as const)
  : [];
