import { Suspense, createContext, useContext } from "react";
import { installedPlugins } from "../../plugins/installed";
import type { PluginThreadProps, PluginMarkdownProps } from "./api";

const ids = new Set<string>();
for (const plugin of installedPlugins) {
  if (ids.has(plugin.id)) throw new Error(`Duplicate native plugin: ${plugin.id}`);
  ids.add(plugin.id);
}

export function PluginThreadHeader(props: PluginThreadProps) {
  return installedPlugins.map(({ id, ThreadHeader }) =>
    ThreadHeader ? (
      <Suspense key={id} fallback={null}>
        <ThreadHeader {...props} />
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
