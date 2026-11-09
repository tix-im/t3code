import { pluginActive } from "./active.ts";
import { toolkit } from "./tixim/mcp-tools.ts";
import { layer } from "./tixim/mcp-handlers.ts";

export const pluginToolkits = pluginActive ? ([{ toolkit, handlers: layer }] as const) : [];
