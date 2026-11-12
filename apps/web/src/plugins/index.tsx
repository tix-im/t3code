import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, Suspense, useContext } from "react";
import { installedWebPlugins } from "../../plugins/installed";
import type { PluginSidebarThread, PluginSidebarThreadActionProps, PluginThreadProps } from "./api";
import { createWebPluginRegistry } from "./registry";

export const webPlugins = createWebPluginRegistry(installedWebPlugins);
export const usePluginProjectGrouping =
  webPlugins.projectGrouping ?? (() => new Map<string, string>());

export function PluginThreadHeaders(props: PluginThreadProps) {
  return webPlugins.headers.map(({ id, Component }) => (
    <Suspense key={id} fallback={null}>
      <Component {...props} />
    </Suspense>
  ));
}

export function PluginSidebarUtilities() {
  return webPlugins.sidebarUtilities.map(({ id, Component }) => (
    <Suspense key={id} fallback={null}>
      <Component />
    </Suspense>
  ));
}

export function PluginThreadDetails({
  visible,
  ...props
}: PluginThreadProps & {
  visible: Readonly<Record<string, boolean | undefined>>;
}) {
  return webPlugins.threadDetails.map(({ id, Component }) =>
    visible[id] ? (
      <Suspense key={id} fallback={null}>
        <Component {...props} />
      </Suspense>
    ) : null,
  );
}

const NO_SIDEBAR_THREADS: ReadonlyMap<string, PluginSidebarThread> = new Map();
const noSidebarThreads = () => NO_SIDEBAR_THREADS;
// The registry is fixed at build time, so the chosen hook never changes between renders.
export const usePluginSidebarThreads: (
  environmentIds: ReadonlyArray<EnvironmentId>,
) => ReadonlyMap<string, PluginSidebarThread> =
  webPlugins.sidebarThreads?.useThreads ?? noSidebarThreads;

const PluginSidebarThreadsContext = createContext(NO_SIDEBAR_THREADS);
export const PluginSidebarThreadsProvider = PluginSidebarThreadsContext.Provider;
export function usePluginSidebarThread(threadKey: string): PluginSidebarThread | undefined {
  return useContext(PluginSidebarThreadsContext).get(threadKey);
}

export function PluginSidebarThreadAction(props: PluginSidebarThreadActionProps) {
  const RowAction = webPlugins.sidebarThreads?.RowAction;
  return RowAction ? (
    <Suspense fallback={null}>
      <RowAction {...props} />
    </Suspense>
  ) : null;
}
