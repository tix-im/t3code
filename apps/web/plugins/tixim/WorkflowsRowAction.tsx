import type { TiximWorkflowRun } from "@t3tools/contracts";
import { HourglassIcon, WorkflowIcon } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import type { PluginSidebarThreadActionProps } from "../../src/plugins/api";
import {
  cn,
  CopyValueButton,
  Dialog,
  DialogPopup,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  ThreadDetailsControl,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  useEnvironmentQuery,
  useNowMinute,
} from "../../src/plugins/host";
import { FlowFrame } from "./FlowFrame";
import { workflowOverviewAtom } from "./sidebarThreads";
import { DialogRunTitle } from "./ThreadWorkflowsControl";
import { WorkflowTally } from "./WorkflowTally";
import { WORKFLOW_TREE_INDENT, WorkflowTreeGuides } from "./WorkflowTreeGuides";
import {
  orderedRuns,
  WORKFLOW_TONE_CLASS,
  workflowRunElapsed,
  workflowRunKey,
  workflowRunTitle,
  workflowStateGlyph,
  workflowStepCounts,
} from "./workflowPresentation";

// Portaled popups still bubble React events to the sidebar row, which would open or drag it.
const isolate = {
  onClick: (event: SyntheticEvent) => event.stopPropagation(),
  onPointerDown: (event: SyntheticEvent) => event.stopPropagation(),
  onDoubleClick: (event: SyntheticEvent) => event.stopPropagation(),
  onContextMenu: (event: SyntheticEvent) => event.stopPropagation(),
};

export function WorkflowsRowAction({
  environmentId,
  threadId,
  onOpenChange,
}: PluginSidebarThreadActionProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TiximWorkflowRun | null>(null);
  const overview = useEnvironmentQuery(workflowOverviewAtom(environmentId));
  const nowSeconds = Date.parse(`${useNowMinute()}:00Z`) / 1000;
  const thread = overview.data?.threads.find((entry) => entry.threadId === threadId);
  const runs = orderedRuns(thread?.runs ?? []);
  const change = (popover: boolean, run: TiximWorkflowRun | null) => {
    setOpen(popover);
    setSelected(run);
    onOpenChange(popover || run !== null);
  };
  if (runs.length === 0) return null;
  return (
    <span className="flex" {...isolate}>
      <Popover open={open} onOpenChange={(value) => change(value, null)}>
        <Tooltip disabled={open}>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Thread workflows"
                  className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                />
              }
            >
              <WorkflowIcon aria-hidden className="size-3.5" />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipPopup side="top">Workflows</TooltipPopup>
        </Tooltip>
        <PopoverPopup align="end" width="md" padding="none">
          <div className="flex max-h-80 flex-col overflow-auto p-1">
            <h3 className="m-0 px-2.5 pt-1.5 pb-1 text-2xs font-medium text-muted-foreground">
              Workflows
            </h3>
            <ul className="m-0 list-none p-0">
              {runs.map((entry) => {
                const { run } = entry;
                const glyph = workflowStateGlyph(run.state);
                const { icon: Icon } = glyph;
                const elapsed = workflowRunElapsed(run, nowSeconds);
                const waited = thread?.waitingOn.includes(workflowRunKey(run)) === true;
                return (
                  <li
                    key={workflowRunKey(run)}
                    className="group/run relative flex items-center"
                    style={
                      entry.depth > 0
                        ? { paddingInlineStart: entry.depth * WORKFLOW_TREE_INDENT }
                        : undefined
                    }
                  >
                    <WorkflowTreeGuides entry={entry} iconCenterY={16} />
                    <ThreadDetailsControl
                      size="sm"
                      variant="ghost"
                      part="row"
                      className="min-w-0 flex-1"
                      aria-label={`Inspect ${workflowRunTitle(run)}, ${glyph.label}${waited ? ", waited on" : ""}`}
                      onClick={() => change(false, run)}
                    >
                      <Icon
                        aria-hidden
                        className={cn("size-4 shrink-0", WORKFLOW_TONE_CLASS[glyph.tone])}
                      />
                      <span className="min-w-0 flex-1 truncate text-start">
                        {workflowRunTitle(run)}
                      </span>
                      <span className="text-2xs">
                        <WorkflowTally counts={workflowStepCounts(run.steps)} />
                      </span>
                      {waited ? (
                        <HourglassIcon
                          aria-hidden
                          className="size-3 shrink-0 text-info-foreground"
                        />
                      ) : null}
                      {elapsed ? (
                        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                          {elapsed}
                        </span>
                      ) : null}
                    </ThreadDetailsControl>
                    <span className="flex shrink-0 opacity-0 group-hover/run:opacity-100 group-focus-within/run:opacity-100 pointer-coarse:opacity-100">
                      <CopyValueButton value={run.hid ?? run.runId} label="Copy workflow ID" />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </PopoverPopup>
      </Popover>
      <Dialog open={selected !== null} onOpenChange={(value) => !value && change(false, null)}>
        <DialogPopup className="flex h-[85vh] w-[min(1200px,95vw)] max-w-none flex-col">
          {selected ? (
            <>
              <div className="flex min-w-0 items-center gap-2.5 border-b border-border/65 py-2.5 ps-4 pe-12">
                <DialogRunTitle run={selected} />
              </div>
              <FlowFrame
                key={workflowRunKey(selected)}
                environmentId={environmentId}
                threadId={threadId}
                connectionId={selected.connectionId}
                daemonId={selected.daemonId}
                title={`Tix Flow: ${selected.name}`}
                path={`/runs/${encodeURIComponent(selected.runId)}`}
              />
            </>
          ) : null}
        </DialogPopup>
      </Dialog>
    </span>
  );
}
