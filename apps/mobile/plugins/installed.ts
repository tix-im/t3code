import { pluginContract } from "@t3tools/contracts";
import type { NativePlugin } from "../src/plugins/api";
import { tiximPlugin } from "./tixim";
export const installedPlugins: readonly NativePlugin[] = pluginContract.enabled
  ? [tiximPlugin]
  : [];
