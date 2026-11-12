import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderSettingsFormOption,
} from "@t3tools/contracts";
import { useState } from "react";

import {
  useEnvironmentQuery,
  useAtomCommand,
  refreshProviders as refreshProvidersCommand,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";
import {
  configString,
  tiximContextOptions,
  tiximHarnessOptions,
  tiximModelOptions,
} from "./tiximSettingsOptions.logic";

export interface TiximFieldOverride {
  readonly options: ReadonlyArray<ProviderSettingsFormOption>;
  readonly description?: string | undefined;
  readonly control?: "select" | undefined;
  readonly allowCustom?: boolean | undefined;
}

/** Context and harness choices for a Tixim instance, listed by the environment's tix CLI. */
export function useTiximFieldOverrides(
  environmentId: EnvironmentId | undefined,
  config: unknown,
  instanceId?: ProviderInstanceId,
) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshProviders = useAtomCommand(refreshProvidersCommand);
  const context = configString(config, "context");
  const harness = configString(config, "harness");
  const configuredRouting = configString(config, "routing");
  const routing =
    configuredRouting === "gateway" || configuredRouting === "native"
      ? configuredRouting
      : "default";
  const contexts = useEnvironmentQuery(
    environmentId === undefined
      ? null
      : workflowEnvironment.listTiximContexts({ environmentId, input: {} }),
  );
  const harnesses = useEnvironmentQuery(
    environmentId === undefined
      ? null
      : workflowEnvironment.listTiximHarnesses({ environmentId, input: { context } }),
  );
  const models = useEnvironmentQuery(
    environmentId === undefined || !harness
      ? null
      : workflowEnvironment.listTiximModels({
          environmentId,
          input: { context, harness, routing },
        }),
  );
  if (environmentId === undefined) return undefined;
  return {
    isPending:
      refreshing ||
      contexts.isPending ||
      harnesses.isPending ||
      (Boolean(harness) && models.isPending),
    refresh: async () => {
      setRefreshing(true);
      contexts.refresh();
      harnesses.refresh();
      if (harness) models.refresh();
      const operation = instanceId
        ? refreshProviders({ environmentId, input: { instanceId, refreshModels: true } })
        : Promise.resolve();
      await operation.finally(() => setRefreshing(false));
    },
    fields: {
      context: {
        options: tiximContextOptions(contexts.data?.contexts ?? null, context),
        ...(contexts.error
          ? { description: `Could not list tix contexts: ${contexts.error}` }
          : {}),
      },
      harness: {
        options: tiximHarnessOptions(
          harnesses.data?.harnesses ?? null,
          configString(config, "harness"),
          {
            isPending: harnesses.isPending && harnesses.data === null,
            error: harnesses.error,
          },
        ),
        ...(harnesses.error ? { description: harnesses.error } : {}),
      },
      model: {
        control: "select",
        allowCustom: true,
        options: tiximModelOptions(models.data?.models ?? null, configString(config, "model")),
        description: !harness
          ? "Select a harness to list models."
          : models.error
            ? `Could not list models: ${models.error}`
            : models.isPending
              ? "Loading models…"
              : models.data?.models.length === 0
                ? "No models listed by this connection."
                : "Models available for the selected context and routing.",
      },
    } satisfies Readonly<Record<string, TiximFieldOverride>>,
  };
}
