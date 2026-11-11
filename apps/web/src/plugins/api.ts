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

export interface WebPlugin {
  readonly id: string;
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
