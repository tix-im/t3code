import { FolderGit2Icon } from "lucide-react";
import type { WebPlugin } from "../../src/plugins/api";
import { lazy, Suspense } from "react";
import { rehypeWorkflowReferences } from "./markdownWorkflowReferences";
import { useSidebarWorkflowThreads } from "./sidebarThreads";
const MarkdownWorkflowReference = lazy(() =>
  import("./MarkdownWorkflowReference").then((module) => ({
    default: module.MarkdownWorkflowReference,
  })),
);
const ThreadWorkflowsControl = lazy(() =>
  import("./ThreadWorkflowsControl").then((module) => ({ default: module.ThreadWorkflowsControl })),
);

const TiximSidebarUtility = lazy(() =>
  import("./TiximConsole").then((module) => ({ default: module.TiximSidebarUtility })),
);

const WorkflowsRowAction = lazy(() =>
  import("./WorkflowsRowAction").then((module) => ({ default: module.WorkflowsRowAction })),
);

const ProviderSettings = lazy(() =>
  import("./ProviderSettings").then((module) => ({ default: module.ProviderSettings })),
);

const ConnectionSetup = lazy(() =>
  import("./ConnectionSetup").then((module) => ({ default: module.ConnectionSetup })),
);
export const tiximPlugin: WebPlugin = {
  connectionSetup: {
    id: "tixim",
    title: "Tixim",
    description: "Connect to a tixim project sandbox over its tix-* SSH alias.",
    icon: <FolderGit2Icon aria-hidden className="size-4" />,
    available: (bridge) => bridge?.discoverTiximProjects !== undefined,
    Component: ConnectionSetup,
  },
  providerSettings: { driverKind: "tixim", Component: ProviderSettings },
  id: "tixim",
  markdown: {
    rehypePlugins: [rehypeWorkflowReferences],
    renderAnchor: ({ properties, children, threadRef }) => {
      const hid = properties.dataWorkflowHid;
      if (typeof hid !== "string") return null;
      return threadRef ? (
        <Suspense fallback={<span>{hid}</span>}>
          <MarkdownWorkflowReference
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            hid={hid}
          />
        </Suspense>
      ) : (
        <span>{children}</span>
      );
    },
  },
  ThreadHeader: ThreadWorkflowsControl,
  SidebarUtility: TiximSidebarUtility,
  sidebarThreads: { useThreads: useSidebarWorkflowThreads, RowAction: WorkflowsRowAction },
  threadDetails: {
    id: "workflows",
    label: "Workflows",
    defaultVisible: true,
    Component: (props) => <ThreadWorkflowsControl {...props} displayMode="panel" />,
  },
};
