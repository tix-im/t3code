import { createContext, useContext } from "react";

import type { SettingsScopeSearch } from "./settingsScope";
import type { ResolvedSettingsScope } from "./SettingsScopeProvider";

// The provider lives apart because its project groups load the plugin registry, and
// settingsLayout reaches this module through the plugin host facade.
export const SettingsScopeContext = createContext<
  | (ResolvedSettingsScope & {
      singleEnvironment: boolean;
      deviceOnly: boolean;
      search: SettingsScopeSearch;
      selectScope: (next: SettingsScopeSearch) => void;
    })
  | null
>(null);

export function useOptionalSettingsScope() {
  return useContext(SettingsScopeContext);
}

export function useSettingsScope() {
  const scope = useOptionalSettingsScope();
  if (scope === null) throw new Error("Settings scope must be read inside SettingsScopeProvider.");
  return scope;
}
