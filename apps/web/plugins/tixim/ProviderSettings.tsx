import type { PluginProviderSettingsProps } from "../../src/plugins/api";
import { Button, RefreshIcon } from "../../src/plugins/host";
import { useTiximFieldOverrides } from "./tiximSettingsOptions";
import { configString } from "./tiximSettingsOptions.logic";

export function ProviderSettings(props: PluginProviderSettingsProps) {
  const choices = useTiximFieldOverrides(props.environmentId, props.value, props.instanceId);
  const onChange: PluginProviderSettingsProps["onChange"] = (next) => {
    if (
      next !== undefined &&
      configString(next, "context") !== configString(props.value, "context")
    ) {
      const { harness: _harness, ...rest } = next;
      props.onChange(Object.keys(rest).length ? rest : undefined);
    } else props.onChange(next);
  };
  return (
    <>
      {choices ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={choices.isPending}
            aria-busy={choices.isPending}
            onClick={choices.refresh}
          >
            <RefreshIcon refreshing={choices.isPending} />
            Reload
          </Button>
        </div>
      ) : null}
      {props.renderFields({ overrides: choices?.fields, onChange })}
    </>
  );
}
