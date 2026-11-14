import { Suspense, createContext, useContext } from "react";
import { installedPlugins } from "../../plugins/installed";
import type { PluginThreadProps, PluginMarkdownProps } from "./api";

const ids = new Set<string>();
for (const plugin of installedPlugins) {
  if (ids.has(plugin.id)) throw new Error(`Duplicate native plugin: ${plugin.id}`);
  ids.add(plugin.id);
}
export const usePluginProjectGrouping =
  installedPlugins.find((plugin) => plugin.useProjectGrouping)?.useProjectGrouping ??
  (() => new Map<string, string>());

export function PluginThreadHeader(props: PluginThreadProps) {
  return installedPlugins.map(({ id, ThreadHeader }) =>
    ThreadHeader ? (
      <Suspense key={id} fallback={null}>
        <ThreadHeader {...props} />
      </Suspense>
    ) : null,
  );
}
export function PluginProjectSettings(props: {
  environmentId: import("@t3tools/contracts").EnvironmentId;
  projectIds: readonly string[];
}) {
  return installedPlugins.map(({ id, ProjectSettings }) =>
    ProjectSettings ? (
      <Suspense key={id} fallback={null}>
        <ProjectSettings {...props} />
      </Suspense>
    ) : null,
  );
}
export function PluginProjectImport(props: {
  environmentId: import("@t3tools/contracts").EnvironmentId;
}) {
  return installedPlugins.map(({ id, ProjectImport }) =>
    ProjectImport ? (
      <Suspense key={id} fallback={null}>
        <ProjectImport {...props} />
      </Suspense>
    ) : null,
  );
}

const ThreadScope = createContext<PluginThreadProps | null>(null);
export const PluginThreadScope = ThreadScope.Provider;
export function PluginMarkdown(props: Omit<PluginMarkdownProps, keyof PluginThreadProps>) {
  const scope = useContext(ThreadScope);
  const render = (
    index: number,
    markdown: string,
    onLinkPress: PluginMarkdownProps["onLinkPress"],
  ): import("react").ReactNode => {
    const plugin = installedPlugins[index];
    if (!plugin || !scope) return props.renderMarkdown(markdown, onLinkPress);
    const Component = plugin.Markdown;
    if (!Component) return render(index + 1, markdown, onLinkPress);
    return (
      <Suspense fallback={props.renderMarkdown(markdown, onLinkPress)}>
        <Component
          {...scope}
          markdown={markdown}
          onLinkPress={onLinkPress}
          renderMarkdown={(next, nextPress) => render(index + 1, next, nextPress)}
        />
      </Suspense>
    );
  };
  return render(0, props.markdown, props.onLinkPress);
}
