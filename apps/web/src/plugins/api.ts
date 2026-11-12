import type {
  EnvironmentId,
  DesktopBridge,
  DesktopSshEnvironmentTarget,
  ScopedThreadRef,
  ThreadId,
  ProviderInstanceId,
  ProviderSettingsFormControl,
  ProviderSettingsFormOption,
} from "@t3tools/contracts";
import type { ComponentType, ReactElement, ReactNode } from "react";
import type { Options as MarkdownOptions } from "react-markdown";

export interface PluginThreadProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly isServerThread: boolean;
}

export interface PluginMarkdownAnchorProps {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly children: ReactNode;
  readonly threadRef: ScopedThreadRef | undefined;
}

export interface PluginSidebarThreadItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly iconClassName?: string;
}

export interface PluginSidebarThread {
  /** External work holds the thread, so it lists as working rather than snoozed or idle. */
  readonly working: boolean;
  /** Shown when the row has no status of its own, such as a running turn or a request. */
  readonly status?: {
    readonly label: string;
    readonly icon: ComponentType<{ className?: string }>;
  };
  /** One line in the row's hover card. */
  readonly summary?: {
    readonly text: string;
    readonly icon: ComponentType<{ className?: string }>;
  };
  /** What the thread waits on: an extra line on its card and items in its hover card. */
  readonly items?: ReadonlyArray<PluginSidebarThreadItem>;
  /** Replaces the item list beneath the thread with plugin-owned details and controls. */
  readonly rowContent?: ReactNode;
  /** Replaces the item list in the hover card with plugin-owned details and controls. */
  readonly hoverContent?: ReactNode;
}

export interface PluginSidebarThreadActionProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Keeps the row's hover controls visible while the action's popup is open. */
  readonly onOpenChange: (open: boolean) => void;
}

export interface WebPlugin {
  readonly id: string;
  /** Stable logical grouping for project records owned by this plugin. */
  readonly useProjectGrouping?: (
    environmentIds: ReadonlyArray<EnvironmentId>,
  ) => ReadonlyMap<string, string>;
  readonly ProjectSettings?: ComponentType<{
    environmentId: EnvironmentId;
    projectIds: readonly string[];
  }>;
  readonly ProjectImport?: ComponentType<{ environmentId: EnvironmentId }>;
  readonly connectionSetup?: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly icon: ReactNode;
    readonly available: (bridge: DesktopBridge | undefined) => boolean;
    readonly Component: ComponentType<PluginConnectionSetupProps>;
  };
  readonly markdown?: {
    readonly rehypePlugins: NonNullable<MarkdownOptions["rehypePlugins"]>;
    readonly renderAnchor: (props: PluginMarkdownAnchorProps) => ReactElement | null;
  };
  readonly providerSettings?: {
    readonly driverKind: string;
    readonly Component: ComponentType<PluginProviderSettingsProps>;
  };
  readonly ThreadHeader?: ComponentType<PluginThreadProps>;
  /** Rendered in the sidebar's utility row, normally as a host `SidebarUtilityItem`. */
  readonly SidebarUtility?: ComponentType;
  readonly sidebarThreads?: {
    /** Called once per sidebar render. Keys are scoped thread keys; keep the map stable. */
    readonly useThreads: (
      environmentIds: ReadonlyArray<EnvironmentId>,
    ) => ReadonlyMap<string, PluginSidebarThread>;
    /** A hover-only row control beside snooze and settle, for threads in the map. */
    readonly RowAction?: ComponentType<PluginSidebarThreadActionProps>;
  };
  readonly threadDetails?: {
    readonly id: string;
    readonly label: string;
    readonly defaultVisible: boolean;
    readonly Component: ComponentType<PluginThreadProps>;
  };
}

export interface PluginProviderFieldOverride {
  readonly options: ReadonlyArray<ProviderSettingsFormOption>;
  readonly description?: string | undefined;
  readonly control?: ProviderSettingsFormControl | undefined;
  readonly allowCustom?: boolean | undefined;
}
export interface PluginProviderSettingsProps {
  readonly environmentId: EnvironmentId | undefined;
  readonly instanceId: ProviderInstanceId | undefined;
  readonly value: unknown;
  readonly onChange: (next: Record<string, unknown> | undefined) => void;
  readonly renderFields: (options: {
    overrides?: Readonly<Record<string, PluginProviderFieldOverride>> | undefined;
    onChange?: (next: Record<string, unknown> | undefined) => void;
  }) => ReactNode;
}

export interface PluginConnectionSetupProps {
  readonly desktopBridge: DesktopBridge | undefined;
  readonly savedAliases: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly error: string | null;
  readonly onErrorChange: (error: string | null) => void;
  readonly connectSsh: (target: DesktopSshEnvironmentTarget) => Promise<void>;
}
