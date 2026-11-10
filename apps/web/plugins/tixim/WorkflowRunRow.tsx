import { TiximWorkflowRelationship, type TiximWorkflowRun } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  ThreadDetailsControl,
  ThreadHoverCard,
  ThreadHoverCardPopup,
  Tooltip,
  TooltipTrigger,
  useNowMinute,
} from "../../src/plugins/host";
import { WorkflowTally } from "./WorkflowTally";
import {
  describeWorkflowReports,
  describeWorkflowSteps,
  formatWorkflowTime,
  WORKFLOW_RELATIONSHIP_LABELS,
  WORKFLOW_TONE_CLASS,
  workflowReportCounts,
  workflowRunElapsed,
  workflowRunNote,
  workflowRunTitle,
  workflowStateGlyph,
  workflowStepCounts,
  type WorkflowGlyph,
} from "./workflowPresentation";

const SOURCE_LABELS: Record<TiximWorkflowRun["source"], string> = {
  agent_session: "hosts this chat's agent",
  automatic: "attached automatically",
  manual: "attached manually",
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="min-w-0 wrap-anywhere text-foreground/85">{children}</span>
    </div>
  );
}

function WorkflowRunDetails({
  run,
  glyph,
  elapsed,
}: {
  run: TiximWorkflowRun;
  glyph: WorkflowGlyph;
  elapsed: string | null;
}) {
  const { icon: Icon } = glyph;
  const reports = run.reports ? describeWorkflowReports(run.reports) : "";
  const steps = run.steps ? describeWorkflowSteps(run.steps) : "";
  const active = run.activeSteps?.map((step) => step.name).join(", ");
  return (
    <ThreadHoverCard title={workflowRunTitle(run)}>
      <span className={cn("flex items-center gap-1.5", WORKFLOW_TONE_CLASS[glyph.tone])}>
        <Icon aria-hidden className="size-3" />
        {glyph.label}
      </span>
      <span className="truncate">{run.hid ?? run.runId}</span>
      {run.definitionName ? <DetailRow label="Workflow">{run.definitionName}</DetailRow> : null}
      {steps ? <DetailRow label="Steps">{steps}</DetailRow> : null}
      {active ? <DetailRow label="Now">{active}</DetailRow> : null}
      {reports ? <DetailRow label="Reports">{reports}</DetailRow> : null}
      {run.latestReport ? <DetailRow label="Latest">{run.latestReport.message}</DetailRow> : null}
      {run.statusMessage ? <DetailRow label="Status">{run.statusMessage}</DetailRow> : null}
      {run.waitingReason ? (
        <DetailRow label="Waiting">{run.waitingReason.replaceAll("_", " ")}</DetailRow>
      ) : null}
      {run.startedAt !== null ? (
        <DetailRow label="Started">
          {[formatWorkflowTime(run.startedAt), elapsed].filter(Boolean).join(", ")}
        </DetailRow>
      ) : null}
      <DetailRow label="Link">
        {WORKFLOW_RELATIONSHIP_LABELS[run.relationship]}, {SOURCE_LABELS[run.source]}
      </DetailRow>
    </ThreadHoverCard>
  );
}

export function WorkflowRunRow({
  run,
  depth,
  refreshing,
  busy,
  onOpen,
  onRelationshipChange,
  onDetach,
}: {
  run: TiximWorkflowRun;
  depth: number;
  /** The daemon has not answered yet, so the saved state is shown rather than "unavailable". */
  refreshing: boolean;
  busy: boolean;
  onOpen: (run: TiximWorkflowRun) => void;
  onRelationshipChange: (run: TiximWorkflowRun, relationship: TiximWorkflowRelationship) => void;
  onDetach: (run: TiximWorkflowRun) => void;
}) {
  const nowSeconds = Date.parse(`${useNowMinute()}:00Z`) / 1000;
  const available = run.availability === "available";
  const known = available || refreshing;
  const glyph = workflowStateGlyph(known ? run.state : "unavailable");
  const { icon: Icon } = glyph;
  const title = workflowRunTitle(run);
  const elapsed = known ? workflowRunElapsed(run, nowSeconds) : null;
  const steps = workflowStepCounts(run.steps);
  const reports = workflowReportCounts(run.reports);
  const note = known ? workflowRunNote(run) : null;
  const NoteIcon = note?.icon;
  return (
    <li
      className="group relative flex items-center rounded-lg"
      style={depth > 0 ? { marginInlineStart: depth * 12 } : undefined}
    >
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="row"
              multiline
              aria-disabled={available ? undefined : true}
              onClick={() => {
                if (available) onOpen(run);
              }}
            />
          }
        >
          <Icon
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 self-start", WORKFLOW_TONE_CLASS[glyph.tone])}
          />
          {/* The end padding keeps text clear of the row menu. */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 pe-6">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium leading-4 text-foreground/85">
                {title}
              </span>
              <span className="sr-only">{glyph.label}</span>
              {elapsed ? (
                <span className="shrink-0 text-2xs font-normal leading-4 tabular-nums text-muted-foreground">
                  {elapsed}
                </span>
              ) : null}
            </span>
            {steps.length > 0 || reports.length > 0 ? (
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 text-2xs font-normal leading-4">
                <WorkflowTally counts={steps} />
                <WorkflowTally counts={reports} />
              </span>
            ) : null}
            {note && NoteIcon ? (
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1 text-2xs font-normal leading-4",
                  WORKFLOW_TONE_CLASS[note.tone],
                )}
              >
                <NoteIcon aria-hidden className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{note.text}</span>
              </span>
            ) : null}
          </span>
        </TooltipTrigger>
        <ThreadHoverCardPopup side="left">
          <WorkflowRunDetails run={run} glyph={glyph} elapsed={elapsed} />
        </ThreadHoverCardPopup>
      </Tooltip>
      <div className="pointer-events-none absolute top-1 right-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <Menu>
          <MenuTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                disabled={busy}
                aria-label={`Manage ${title}`}
              />
            }
          >
            <EllipsisIcon aria-hidden className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup
              value={run.relationship}
              onValueChange={(value: TiximWorkflowRelationship) => onRelationshipChange(run, value)}
              aria-label="Relationship to this chat"
            >
              {TiximWorkflowRelationship.literals.map((value) => (
                <MenuRadioItem key={value} value={value} closeOnClick disabled={!available}>
                  {WORKFLOW_RELATIONSHIP_LABELS[value]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuItem onClick={() => onDetach(run)}>Detach</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </li>
  );
}
