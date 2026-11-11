import type { PluginMarkdownAnchorProps, WebPlugin } from "./api";

export function createWebPluginRegistry(plugins: readonly WebPlugin[]) {
  const ids = new Set<string>();
  const sectionIds = new Set<string>();
  const providerIds = new Set<string>();
  const setupIds = new Set(["remote", "ssh"]);
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) throw new Error(`Duplicate web plugin: ${plugin.id}`);
    ids.add(plugin.id);
    if (plugin.connectionSetup) {
      if (setupIds.has(plugin.connectionSetup.id))
        throw new Error(`Duplicate connection setup: ${plugin.connectionSetup.id}`);
      setupIds.add(plugin.connectionSetup.id);
    }
    if (plugin.providerSettings) {
      if (providerIds.has(plugin.providerSettings.driverKind))
        throw new Error(`Duplicate provider settings: ${plugin.providerSettings.driverKind}`);
      providerIds.add(plugin.providerSettings.driverKind);
    }
    if (plugin.sidebarThreads && plugins.some((other) => other !== plugin && other.sidebarThreads))
      throw new Error(`Only one plugin may annotate sidebar threads: ${plugin.id}`);
    if (plugin.threadDetails) {
      if (sectionIds.has(plugin.threadDetails.id))
        throw new Error(`Duplicate plugin section: ${plugin.threadDetails.id}`);
      sectionIds.add(plugin.threadDetails.id);
    }
  }
  return {
    connectionSetups: plugins.flatMap((plugin) =>
      plugin.connectionSetup ? [plugin.connectionSetup] : [],
    ),
    rehypePlugins: plugins.flatMap((plugin) => plugin.markdown?.rehypePlugins ?? []),
    providerSettings: plugins.flatMap((plugin) =>
      plugin.providerSettings ? [plugin.providerSettings] : [],
    ),
    headers: plugins.flatMap((plugin) =>
      plugin.ThreadHeader ? [{ id: plugin.id, Component: plugin.ThreadHeader }] : [],
    ),
    sidebarUtilities: plugins.flatMap((plugin) =>
      plugin.SidebarUtility ? [{ id: plugin.id, Component: plugin.SidebarUtility }] : [],
    ),
    sidebarThreads: plugins.find((plugin) => plugin.sidebarThreads)?.sidebarThreads,
    threadDetails: plugins.flatMap((plugin) =>
      plugin.threadDetails ? [plugin.threadDetails] : [],
    ),
    renderMarkdownAnchor(props: PluginMarkdownAnchorProps) {
      for (const plugin of plugins) {
        const element = plugin.markdown?.renderAnchor(props);
        if (element != null) return element;
      }
      return null;
    },
  };
}
