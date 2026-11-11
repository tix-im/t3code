import { lazy } from "react";
import type { NativePlugin } from "../../src/plugins/api";
import { useTiximProjectGrouping } from "./projectGrouping";
export const tiximPlugin: NativePlugin = {
  id: "tixim",
  useProjectGrouping: useTiximProjectGrouping,
  Markdown: lazy(() =>
    import("./MarkdownReferences").then((module) => ({ default: module.MarkdownReferences })),
  ),
  ThreadHeader: lazy(() =>
    import("./ThreadWorkflows").then((module) => ({ default: module.ThreadWorkflows })),
  ),
  ProjectSettings: lazy(() =>
    import("./ProjectIntegration").then((module) => ({ default: module.ProjectSettings })),
  ),
  ProjectImport: lazy(() =>
    import("./ProjectIntegration").then((module) => ({ default: module.ProjectImport })),
  ),
};
