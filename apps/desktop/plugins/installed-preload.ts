// Relative so this dependency-free file is inlined: a sandboxed preload cannot require packages.
import { enabled } from "../../../packages/plugin-tixim-contracts/src/configuration.ts";
import { createBridge } from "./tixim/preload.ts";
export const createPluginBridge = (invoke: Parameters<typeof createBridge>[0]) =>
  enabled ? createBridge(invoke) : {};
