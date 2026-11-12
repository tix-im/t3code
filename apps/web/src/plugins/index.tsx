import { Suspense } from "react";
import { installedWebPlugins } from "../../plugins/installed";
import type { PluginThreadProps } from "./api";
import { createWebPluginRegistry } from "./registry";

export const webPlugins = createWebPluginRegistry(installedWebPlugins);

export function PluginThreadHeaders(props: PluginThreadProps) {
  return webPlugins.headers.map(({ id, Component }) => (
    <Suspense key={id} fallback={null}>
      <Component {...props} />
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
