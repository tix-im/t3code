import {
  ProviderDriverKind,
  ServerProviderIcon,
  TiximModelMetadata,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AcpRegistrySettings } from "@t3tools/provider-acp-registry/settings";
import {
  makeAcpRegistryBackedDriver,
  type AcpRegistryModelDescriber,
} from "@t3tools/provider-acp-registry/server";
import { TIXIM_LINGER_SECONDS, TiximSettings } from "./settings.ts";

export const TIXIM_DRIVER_KIND = ProviderDriverKind.make("tixim");
const TIXIM_COMMAND = "tix";

// Login-shell PATH hydration must not replace the package's matching CLI.
export const resolveTiximCommand = (environment: NodeJS.ProcessEnv = process.env): string =>
  environment.T3_TIXIM_CLI_PATH?.trim() || TIXIM_COMMAND;

const decodeSettings = Schema.decodeSync(TiximSettings);
const decodeIcon = Schema.decodeUnknownOption(ServerProviderIcon);
const decodeModelMetadata = Schema.decodeUnknownOption(TiximModelMetadata);
const TIXIM_MODEL_META_KEY = "tixim.dev/model";
// The ACP config option `tix acp serve` advertises, so threads set the variant there.
const TIXIM_REASONING_OPTION_ID = "thought_level";

/**
 * Env credentials and endpoints outrank a context's own auth.json and URL in
 * tix, so an explicit context drops the ones this host carries (a T3 inside a
 * run or service would otherwise present its own identity to another daemon).
 */
const TIXIM_HOST_CONNECTION_VARIABLES = [
  "TIX_AUTH_TOKEN",
  "TIX_SERVICE_TOKEN",
  "TIX_SERVICE_TOKEN_PATH",
  "TIX_DAEMON_AUTH_TOKEN",
  "TIX_DAEMON_URL",
  "TIX_DAEMON_GRPC_ENDPOINT",
  "TIX_CONTEXT",
  "TIXIM_URL",
] as const;

export function tiximCommandArgs(settings: TiximSettings): ReadonlyArray<string> {
  const linger = TIXIM_LINGER_SECONDS[settings.linger];
  return [
    ...(settings.context ? ["--context", settings.context] : []),
    "acp",
    "serve",
    "--harness",
    settings.harness,
    ...(settings.model ? ["--model", settings.model] : []),
    ...(settings.routing === "gateway" ? ["--gateway"] : []),
    ...(settings.routing === "native" ? ["--native"] : []),
    ...(linger > 0 ? ["--linger", String(linger)] : []),
    ...(settings.workflow ? ["--workflow", settings.workflow] : []),
  ];
}

export function tiximAcpSettings(
  settings: TiximSettings,
  environment: NodeJS.ProcessEnv = process.env,
): AcpRegistrySettings {
  return {
    source: "local",
    enabled: settings.enabled,
    agentId: "",
    // No harness leaves the instance unconfigured instead of failing to spawn.
    commandPath: settings.harness ? resolveTiximCommand(environment) : "",
    commandArgs: settings.harness ? tiximCommandArgs(settings) : [],
    authMethodId: "",
    distribution: "auto",
    customModels: settings.customModels,
  };
}

/**
 * The default context inside a tix run is the run's own daemon: `tix acp serve`
 * honors TIXIM_URL but not the runner's TIX_DAEMON_URL.
 */
export function tiximHostEnvironment(
  environment: NodeJS.ProcessEnv,
  settings: Pick<TiximSettings, "context">,
): NodeJS.ProcessEnv {
  if (!settings.context) {
    const runDaemon = environment.TIX_DAEMON_URL?.trim();
    return runDaemon && !environment.TIXIM_URL?.trim()
      ? { ...environment, TIXIM_URL: runDaemon }
      : environment;
  }
  const next = { ...environment };
  // Child processes extend the ambient env; undefined masks inherited credentials.
  for (const name of TIXIM_HOST_CONNECTION_VARIABLES) next[name] = undefined;
  return next;
}

/** "Tixim Claude" with the harness's TiX-merged icon, once a harness with an icon is picked. */
export function tiximBranding(settings: TiximSettings) {
  if (!settings.harness) return {};
  return {
    displayName: `Tixim ${settings.harnessLabel || settings.harness}`,
    icon: Option.getOrUndefined(decodeIcon(settings.harnessIcon)),
  };
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function tiximReasoningOption(metadata: TiximModelMetadata): ProviderOptionDescriptor | undefined {
  const variants = [...new Set(metadata.variants ?? [])].filter(
    (variant) => variant.length > 0 && variant !== "default",
  );
  if (variants.length === 0) return undefined;
  const defaultVariant = variants.find((variant) => variant === metadata.defaultVariant);
  return {
    id: TIXIM_REASONING_OPTION_ID,
    type: "select",
    label: "Reasoning",
    role: "reasoning",
    options: [
      { id: "default", label: "Model default", isDefault: defaultVariant === undefined },
      ...variants.map((variant) => ({
        id: variant,
        label: capitalize(variant),
        ...(variant === defaultVariant ? { isDefault: true } : {}),
      })),
    ],
  };
}

// The context window has its own badge, so the summary leaves it out.
function tiximMetadataSummary(metadata: TiximModelMetadata): string | undefined {
  const cost = metadata.cost;
  const parts = [
    metadata.provider,
    metadata.reasoning ? "reasoning" : undefined,
    cost?.inputPerMillion !== undefined && cost.outputPerMillion !== undefined
      ? `$${cost.inputPerMillion} / $${cost.outputPerMillion} per M`
      : undefined,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** Reads the model metadata `tix acp serve` attaches to each model choice. */
export const describeTiximModel: AcpRegistryModelDescriber = (choice) => {
  const metadata = Option.getOrUndefined(decodeModelMetadata(choice.meta?.[TIXIM_MODEL_META_KEY]));
  if (metadata === undefined) return undefined;
  const reasoning = tiximReasoningOption(metadata);
  return {
    contextWindow: metadata.contextWindow,
    description: choice.description ?? metadata.description ?? tiximMetadataSummary(metadata),
    ...(reasoning === undefined ? {} : { optionDescriptors: [reasoning] }),
  };
};

export const TiximDriver = makeAcpRegistryBackedDriver<TiximSettings>({
  driverKind: TIXIM_DRIVER_KIND,
  displayName: "Tixim",
  configSchema: TiximSettings,
  defaultConfig: () => decodeSettings({}),
  toAcpSettings: tiximAcpSettings,
  hostEnvironment: tiximHostEnvironment,
  unconfiguredMessage: "Select a tixim harness before starting a thread.",
  branding: tiximBranding,
  describeModel: describeTiximModel,
});
