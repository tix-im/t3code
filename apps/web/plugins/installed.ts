import { pluginContract } from "@t3tools/contracts";
import type { WebPlugin } from "../src/plugins/api";
import { tiximPlugin } from "./tixim";

export const installedWebPlugins: readonly WebPlugin[] = pluginContract.enabled
  ? [tiximPlugin]
  : [];
