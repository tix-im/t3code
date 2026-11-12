import { lazy } from "react";
import type { NativePlugin } from "../../src/plugins/api";
export const tiximPlugin: NativePlugin = {
  id: "tixim",
  Markdown: lazy(() =>
    import("./MarkdownReferences").then((module) => ({ default: module.MarkdownReferences })),
  ),
  ThreadHeader: lazy(() =>
    import("./ThreadWorkflows").then((module) => ({ default: module.ThreadWorkflows })),
  ),
};
