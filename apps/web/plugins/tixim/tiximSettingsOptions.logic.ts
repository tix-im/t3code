import {
  ServerProviderIcon,
  type ProviderSettingsFormOption,
  type TiximConcreteRouting,
  type TiximContext,
  type TiximHarness,
  type TiximListModelsResult,
} from "@t3tools/contracts";
import { formatContextWindow } from "@t3tools/shared/usageFormat";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export function configString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/** Keeps a configured value selectable even when the daemon no longer lists it. */
function withConfigured(
  options: ReadonlyArray<ProviderSettingsFormOption>,
  configured: string,
  label: (value: string) => string,
): ReadonlyArray<ProviderSettingsFormOption> {
  return configured && !options.some((option) => option.value === configured)
    ? [...options, { value: configured, label: label(configured) }]
    : options;
}

export function tiximContextOptions(
  contexts: ReadonlyArray<TiximContext> | null,
  configured: string,
): ReadonlyArray<ProviderSettingsFormOption> {
  const listed = contexts ?? [];
  // The select stores its first option as an empty value: Default must lead.
  const defaultOption = listed.find((context) => context.name === "") ?? {
    name: "",
    label: "Default",
  };
  const options = [
    { value: "", label: defaultOption.label },
    ...listed
      .filter((context) => context.name !== "")
      .map((context) => ({
        value: context.name,
        label: context.url ? `${context.name} (${context.url})` : context.name,
      })),
  ];
  return withConfigured(options, configured, (name) => `${name} (not listed)`);
}

export function tiximHarnessOptions(
  harnesses: ReadonlyArray<TiximHarness> | null,
  configured: string,
  state: { readonly isPending: boolean; readonly error: string | null },
): ReadonlyArray<ProviderSettingsFormOption> {
  const placeholder = state.isPending
    ? "Loading harnesses…"
    : state.error
      ? "Could not list harnesses"
      : harnesses !== null && harnesses.length === 0
        ? "No ACP harnesses on this daemon"
        : "Select a harness";
  const options = [
    { value: "", label: placeholder },
    ...(harnesses ?? []).map((harness) => ({
      value: harness.name,
      label: harness.authenticated ? harness.name : `${harness.name} (not signed in)`,
    })),
  ];
  return withConfigured(options, configured, (name) => `${name} (not listed)`);
}

const decodeProviderIcon = Schema.decodeUnknownOption(ServerProviderIcon);

/**
 * Stores the listed harness's label and TiX-merged icon with the config. An
 * unlisted harness keeps what it has unless it was just changed.
 */
export function withHarnessBranding(
  next: Record<string, unknown>,
  previous: unknown,
  harnesses: ReadonlyArray<TiximHarness> | null,
): Record<string, unknown> {
  const harness = configString(next, "harness");
  const listed = harnesses?.find((candidate) => candidate.name === harness);
  if (!listed && harness === configString(previous, "harness")) return next;
  const { harnessLabel: _label, harnessIcon: _icon, ...rest } = next;
  if (!listed?.icon) return rest;
  const icon = Option.getOrUndefined(decodeProviderIcon(listed.icon.tixim));
  return {
    ...rest,
    // The generic TiX mark has no brand to name; the harness name says more.
    ...(listed.icon.id !== "tix" && listed.icon.label ? { harnessLabel: listed.icon.label } : {}),
    ...(icon ? { harnessIcon: icon } : {}),
  };
}

const ROUTING_LABELS: Readonly<Record<TiximConcreteRouting, string>> = {
  gateway: "Tix gateway",
  native: "Harness login",
};
const DEFAULT_ROUTING_LABELS: Readonly<Record<TiximConcreteRouting, string>> = {
  gateway: "Default (Tix gateway)",
  native: "Default (harness login)",
};
const CONCRETE_ROUTINGS: ReadonlyArray<TiximConcreteRouting> = ["gateway", "native"];

/** The routings the harness supports, all of them when its daemon does not say. */
export function tiximRoutingOptions(
  harness: TiximHarness | undefined,
  configured: string,
): ReadonlyArray<ProviderSettingsFormOption> {
  const routing = harness?.routing;
  const options = [
    {
      value: "default",
      label: routing ? DEFAULT_ROUTING_LABELS[routing.default] : "Harness default",
    },
    ...CONCRETE_ROUTINGS.filter((value) => routing?.supported.includes(value) ?? true).map(
      (value) => ({ value, label: ROUTING_LABELS[value] }),
    ),
  ];
  return withConfigured(options, configured, (value) =>
    value === "gateway" || value === "native"
      ? `${ROUTING_LABELS[value]} (not supported)`
      : `${value} (not supported)`,
  );
}

function tiximModelLabel(model: TiximListModelsResult["models"][number]): string {
  const variants = model.variants?.filter((variant) => variant !== "default") ?? [];
  return [
    model.name || model.id,
    model.contextWindow ? formatContextWindow(model.contextWindow) : undefined,
    variants.length > 0 ? variants.join("/") : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

export function tiximModelOptions(
  models: TiximListModelsResult["models"] | null,
  configured: string,
): ReadonlyArray<ProviderSettingsFormOption> {
  return withConfigured(
    [
      { value: "", label: "Harness default" },
      ...(models ?? []).map((model) => ({ value: model.id, label: tiximModelLabel(model) })),
    ],
    configured,
    (id) => `${id} (not listed)`,
  );
}
