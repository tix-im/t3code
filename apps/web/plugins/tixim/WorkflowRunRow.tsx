import {
  type EnvironmentId,
  type ThreadId,
  TiximWorkflowRelationship,
  type TiximWorkflowRun,
} from "@t3tools/contracts";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  ClockIcon,
  EllipsisIcon,
  FlagIcon,
  HourglassIcon,
  LinkIcon,
  ListChecksIcon,
  PlayIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  cn,
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  ThreadDetailsControl,
  ThreadHoverCard,
  ThreadHoverCardPopup,
  Tooltip,
  TooltipTrigger,
  useNowMinute,
} from "../../src/plugins/host";
import { WorkflowRunLog } from "./WorkflowRunLog";
import { WorkflowTally } from "./WorkflowTally";
import {
  formatWorkflowTime,
  isFinishedWorkflowState,
  WORKFLOW_RELATIONSHIP_LABELS,
  WORKFLOW_TONE_CLASS,
  workflowReportCounts,
  workflowReportGlyph,
  workflowRunElapsed,
  workflowRunNote,
  workflowRunTitle,
  workflowStateGlyph,
  workflowStepCounts,
  workflowStepProgress,
  type WorkflowGlyph,
} from "./workflowPresentation";

const SOURCE_LABELS: Record<TiximWorkflowRun["source"], string> = {
  agent_session: "hosts this chat's agent",
  automatic: "attached automatically",
  manual: "attached manually",
};

function DetailRow({
  icon: Icon,
  iconClassName,
  label,
  wrap = false,
  children,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground/70">
        <Icon aria-hidden className={cn("size-3 shrink-0", iconClassName)} />
        {label}
      </span>
      <span className={cn("min-w-0 text-foreground/85", !wrap && "truncate")}>{children}</span>
    </div>
  );
}

function WorkflowRunDetails({
  run,
  glyph,
  elapsed,
  onOpen,
}: {
  run: TiximWorkflowRun;
  glyph: WorkflowGlyph;
  elapsed: string | null;
  onOpen: (() => void) | null;
}) {
  const { icon: Icon } = glyph;
  const title = workflowRunTitle(run);
  const steps = workflowStepCounts(run.steps, true);
  const reports = workflowReportCounts(run.reports);
  const active = run.activeSteps?.map((step) => step.name).join(", ");
  const latest = run.latestReport ? workflowReportGlyph(run.latestReport.type) : null;
  return (
    <ThreadHoverCard
      title={title}
      wide
      footer={
        onOpen ? (
          <div className="border-t border-border/65 pt-1">
            <ThreadDetailsControl size="sm" variant="ghost" part="row" onClick={onOpen}>
              <WorkflowIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span className="min-w-0 flex-1 truncate text-start">Open workflow</span>
              <ArrowUpRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            </ThreadDetailsControl>
          </div>
        ) : undefined
      }
    >
      <div className="flex w-88 max-w-full min-w-0 items-center justify-between gap-4">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 font-medium",
            WORKFLOW_TONE_CLASS[glyph.tone],
          )}
        >
          <Icon aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{glyph.label}</span>
        </span>
        {elapsed ? <span className="shrink-0 tabular-nums">{elapsed}</span> : null}
      </div>
      <span className="truncate">{run.hid ?? run.runId}</span>
      <div aria-hidden className="h-px bg-border/65" />
      {run.definitionName && run.definitionName !== title ? (
        <DetailRow icon={WorkflowIcon} label="Workflow">
          {run.definitionName}
        </DetailRow>
      ) : null}
      {steps.length > 0 ? (
        <DetailRow icon={ListChecksIcon} label="Steps" wrap>
          <WorkflowTally counts={steps} labelled />
        </DetailRow>
      ) : null}
      {active ? (
        <DetailRow icon={PlayIcon} label="Now">
          {active}
        </DetailRow>
      ) : null}
      {reports.length > 0 ? (
        <DetailRow icon={FlagIcon} label="Reports" wrap>
          <WorkflowTally counts={reports} noun="reports" labelled />
        </DetailRow>
      ) : null}
      {run.latestReport && latest ? (
        <DetailRow
          icon={latest.icon}
          iconClassName={WORKFLOW_TONE_CLASS[latest.tone]}
          label="Latest"
        >
          {run.latestReport.message}
        </DetailRow>
      ) : null}
      {run.statusMessage ? (
        <DetailRow icon={ActivityIcon} label="Status">
          {run.statusMessage}
        </DetailRow>
      ) : null}
      {run.waitingReason ? (
        <DetailRow icon={HourglassIcon} label="Waiting">
          {run.waitingReason.replaceAll("_", " ")}
        </DetailRow>
      ) : null}
      {run.startedAt !== null ? (
        <DetailRow icon={ClockIcon} label="Started">
          {formatWorkflowTime(run.startedAt)}
        </DetailRow>
      ) : null}
      <DetailRow icon={LinkIcon} label="Link">
        {WORKFLOW_RELATIONSHIP_LABELS[run.relationship]}, {SOURCE_LABELS[run.source]}
      </DetailRow>
    </ThreadHoverCard>
  );
}

function WorkflowProgressBar({
  done,
  total,
  failed,
}: NonNullable<ReturnType<typeof workflowStepProgress>>) {
  return (
    <span
      role="progressbar"
      aria-label="Workflow steps"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="block h-1 overflow-hidden rounded-full bg-muted"
    >
      <span
        className={cn("block h-full", failed ? "bg-destructive" : "bg-info")}
        style={{ width: `${(done / total) * 100}%` }}
      />
    </span>
  );
}

export function WorkflowRunRow({
  environmentId,
  threadId,
  run,
  depth,
  refreshing,
  busy,
  onOpen,
  onRelationshipChange,
  onDetach,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
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
  const progress =
    known && !isFinishedWorkflowState(run.state) ? workflowStepProgress(run.steps) : null;
  const [logOpen, setLogOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <li
      className="group relative flex flex-col rounded-lg"
      style={depth > 0 ? { marginInlineStart: depth * 12 } : undefined}
    >
      <Tooltip open={hovered} onOpenChange={setHovered}>
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
            {progress ? <WorkflowProgressBar {...progress} /> : null}
            {steps.length > 0 || reports.length > 0 ? (
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 text-2xs font-normal leading-4">
                <WorkflowTally counts={steps} />
                <WorkflowTally counts={reports} noun="reports" />
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
        <ThreadHoverCardPopup side="left" className="pointer-events-auto max-w-96">
          <WorkflowRunDetails
            run={run}
            glyph={glyph}
            elapsed={elapsed}
            onOpen={
              available
                ? () => {
                    setHovered(false);
                    onOpen(run);
                  }
                : null
            }
          />
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
            <MenuItem disabled={!available} onClick={() => setLogOpen((value) => !value)}>
              {logOpen ? "Hide log" : "Show log"}
            </MenuItem>
            <MenuItem onClick={() => onDetach(run)}>Detach</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {logOpen && available ? (
        <WorkflowRunLog environmentId={environmentId} threadId={threadId} run={run} />
      ) : null}
    </li>
  );
}
