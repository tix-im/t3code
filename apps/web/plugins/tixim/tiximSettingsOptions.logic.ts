import type {
  ProviderSettingsFormOption,
  TiximContext,
  TiximHarness,
  TiximListModelsResult,
} from "@t3tools/contracts";

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

export function tiximModelOptions(
  models: TiximListModelsResult["models"] | null,
  configured: string,
): ReadonlyArray<ProviderSettingsFormOption> {
  return withConfigured(
    [
      { value: "", label: "Harness default" },
      ...(models ?? []).map((model) => ({ value: model.id, label: model.name || model.id })),
    ],
    configured,
    (id) => `${id} (not listed)`,
  );
}
