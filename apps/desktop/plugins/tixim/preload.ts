import type { PluginDesktopBridge } from "@t3tools/contracts";
import * as Channels from "./channels.ts";
export function createBridge(invoke: (channel: string) => Promise<unknown>): PluginDesktopBridge {
  return {
    discoverTiximProjects: () =>
      invoke(Channels.DISCOVER_TIXIM_PROJECTS_CHANNEL) as ReturnType<
        NonNullable<PluginDesktopBridge["discoverTiximProjects"]>
      >,
    installTiximSshConfig: () => invoke(Channels.INSTALL_TIXIM_SSH_CONFIG_CHANNEL) as Promise<void>,
  };
}
