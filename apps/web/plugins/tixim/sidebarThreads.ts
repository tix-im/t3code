import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  ThreadId,
  type TiximThreadWorkflows,
  type TiximWorkflowOverview,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { WorkflowIcon } from "lucide-react";
import type { PluginSidebarThread } from "../../src/plugins/api";
import { workflowEnvironment } from "./state";
import {
  WORKFLOW_TONE_CLASS,
  workflowRunCounts,
  workflowRunKey,
  workflowRunTitle,
  workflowStateGlyph,
} from "./workflowPresentation";

export const workflowOverviewAtom = (environmentId: EnvironmentId) =>
  workflowEnvironment.tiximWorkflowOverview({ environmentId, input: {} });

// Keyed by the joined environment IDs, so a re-render with the same environments reuses one atom.
const overviewsAtom = Atom.family((environmentIds: string) =>
  Atom.make((get) =>
    environmentIds
      .split("\n")
      .filter(Boolean)
      .map((environmentId) => ({
        environmentId: environmentId as EnvironmentId,
        overview: AsyncResult.getOrElse(
          get(workflowOverviewAtom(environmentId as EnvironmentId)),
          () => null,
        ),
      })),
  ),
);

const describedThreads = new WeakMap<
  ReadonlyArray<{
    environmentId: EnvironmentId;
    overview: typeof TiximWorkflowOverview.Type | null;
  }>,
  ReadonlyMap<string, PluginSidebarThread>
>();

function describeWorkflowThread(thread: TiximThreadWorkflows): PluginSidebarThread {
  const waiting = thread.runs.filter((run) => thread.waitingOn.includes(workflowRunKey(run)));
  const counts = workflowRunCounts(thread.runs)
    .map(({ count, label }) => `${count} ${label}`)
    .join(", ");
  return {
    working: waiting.length > 0,
    ...(waiting.length > 0 ? { status: { label: "Working", icon: WorkflowIcon } } : {}),
    summary: {
      icon: WorkflowIcon,
      text:
        waiting.length > 0
          ? `Waiting on ${waiting.length} of ${thread.runs.length} workflows`
          : `${thread.runs.length === 1 ? "1 workflow" : `${thread.runs.length} workflows`}: ${counts}`,
    },
    items: waiting.map((run) => {
      const glyph = workflowStateGlyph(run.state);
      return {
        key: workflowRunKey(run),
        label: workflowRunTitle(run),
        icon: glyph.icon,
        iconClassName: WORKFLOW_TONE_CLASS[glyph.tone],
      };
    }),
  };
}

export function useSidebarWorkflowThreads(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyMap<string, PluginSidebarThread> {
  const overviews = useAtomValue(overviewsAtom(environmentIds.toSorted().join("\n")));
  let threads = describedThreads.get(overviews);
  if (threads === undefined) {
    const next = new Map<string, PluginSidebarThread>();
    for (const { environmentId, overview } of overviews)
      for (const thread of overview?.threads ?? [])
        next.set(
          scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(thread.threadId))),
          describeWorkflowThread(thread),
        );
    threads = next;
    describedThreads.set(overviews, threads);
  }
  return threads;
}
