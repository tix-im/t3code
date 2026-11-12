import { ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { AcpRegistrySettings } from "@t3tools/provider-acp-registry/settings";
import { makeAcpRegistryBackedDriver } from "@t3tools/provider-acp-registry/server";
import { TIXIM_LINGER_SECONDS, TiximSettings } from "./settings.ts";

export const TIXIM_DRIVER_KIND = ProviderDriverKind.make("tixim");
const TIXIM_COMMAND = "tix";

// Login-shell PATH hydration must not replace the package's matching CLI.
export const resolveTiximCommand = (environment: NodeJS.ProcessEnv = process.env): string =>
  environment.T3_TIXIM_CLI_PATH?.trim() || TIXIM_COMMAND;

const decodeSettings = Schema.decodeSync(TiximSettings);

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

export const TiximDriver = makeAcpRegistryBackedDriver<TiximSettings>({
  driverKind: TIXIM_DRIVER_KIND,
  displayName: "Tixim",
  configSchema: TiximSettings,
  defaultConfig: () => decodeSettings({}),
  toAcpSettings: tiximAcpSettings,
  hostEnvironment: tiximHostEnvironment,
  unconfiguredMessage: "Select a tixim harness before starting a thread.",
});
