import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "./preferences";
import { useProjects } from "./entities";
import { usePluginProjectGrouping } from "../plugins";
import {
  DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS,
  resolveMobileProjectGroupingSettings,
} from "./project-grouping.logic";

export * from "./project-grouping.logic";

export function useMobileProjectGroupingSettings() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const projects = useProjects();
  const linkedProjectGroups = usePluginProjectGrouping([
    ...new Set(projects.map((project) => project.environmentId)),
  ]);
  const settings = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileProjectGroupingSettings(preferencesResult.value)
    : DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS;
  return { ...settings, linkedProjectGroups };
}
