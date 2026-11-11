import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ComponentType, ReactNode } from "react";

export interface PluginThreadProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export interface NativePlugin {
  readonly id: string;
  readonly Markdown?: ComponentType<PluginMarkdownProps>;
  readonly ThreadHeader?: ComponentType<PluginThreadProps>;
  readonly ProjectSettings?: ComponentType<{
    environmentId: EnvironmentId;
    projectIds: readonly string[];
  }>;
  readonly ProjectImport?: ComponentType<{ environmentId: EnvironmentId }>;
  readonly useProjectGrouping?: (
    environmentIds: ReadonlyArray<EnvironmentId>,
  ) => ReadonlyMap<string, string>;
}

export interface PluginMarkdownProps extends PluginThreadProps {
  readonly markdown: string;
  readonly onLinkPress: ((href: string) => void) | undefined;
  readonly renderMarkdown: (
    markdown: string,
    onLinkPress: ((href: string) => void) | undefined,
  ) => ReactNode;
}
