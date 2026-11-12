import { useAtomSet } from "@effect/atom-react";
import type { EnvironmentId, ThreadId, TiximWorkflowRun } from "@t3tools/contracts";
import { ArrowUpRightIcon } from "lucide-react";
import { cn, ThreadDetailsControl } from "../../src/plugins/host";
import { sidebarWorkflowSelectionAtom } from "./sidebarWorkflowSelection";
import { WorkflowProgressBar } from "./WorkflowProgressBar";
import {
  isFinishedWorkflowState,
  WORKFLOW_TONE_CLASS,
  workflowRunKey,
  workflowRunTitle,
  workflowStateGlyph,
  workflowStepProgress,
} from "./workflowPresentation";

export function SidebarWorkflowItems({
  environmentId,
  threadId,
  runs,
  indented = false,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  runs: ReadonlyArray<TiximWorkflowRun>;
  indented?: boolean;
}) {
  const select = useAtomSet(sidebarWorkflowSelectionAtom(environmentId)(threadId));
  if (runs.length === 0) return null;
  return (
    <div className="pointer-events-auto grid min-w-0 gap-2">
      {runs.map((run) => {
        const glyph = workflowStateGlyph(run.state);
        const Icon = glyph.icon;
        const title = workflowRunTitle(run);
        const progress =
          run.availability === "available" && !isFinishedWorkflowState(run.state)
            ? workflowStepProgress(run.steps)
            : null;
        return (
          <div
            key={workflowRunKey(run)}
            className={cn("flex min-w-0 items-center gap-2", indented && "pl-5")}
          >
            <Icon aria-hidden className={cn("size-3 shrink-0", WORKFLOW_TONE_CLASS[glyph.tone])} />
            <div className="grid min-w-0 flex-1 gap-1">
              <span className="wrap-anywhere text-foreground/75">{title}</span>
              {progress ? <WorkflowProgressBar {...progress} /> : null}
            </div>
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="icon"
              aria-label={`Open workflow ${title}`}
              disabled={run.availability !== "available"}
              onDoubleClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                select(run);
              }}
            >
              <ArrowUpRightIcon aria-hidden className="size-3" />
            </ThreadDetailsControl>
          </div>
        );
      })}
    </div>
  );
}
