import type { TiximWorkflowRun } from "@t3tools/contracts";
import {
  ActivityIcon,
  ClockIcon,
  FlagIcon,
  FolderIcon,
  HourglassIcon,
  LinkIcon,
  ListChecksIcon,
  PlayIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn, CopyValueButton, ThreadHoverCard } from "../../src/plugins/host";
import { WorkflowTally } from "./WorkflowTally";
import {
  formatWorkflowTime,
  WORKFLOW_RELATIONSHIP_LABELS,
  WORKFLOW_TONE_CLASS,
  workflowReportCounts,
  workflowReportGlyph,
  workflowRunTitle,
  workflowStepCounts,
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

/** Content for a `ThreadHoverCardPopup`. `attached` is false for runs that only a search found. */
export function WorkflowRunDetails({
  run,
  glyph,
  elapsed,
  attached,
  footer,
}: {
  run: TiximWorkflowRun;
  glyph: WorkflowGlyph;
  elapsed: string | null;
  attached: boolean;
  footer?: ReactNode;
}) {
  const { icon: Icon } = glyph;
  const title = workflowRunTitle(run);
  const steps = workflowStepCounts(run.steps, true);
  const reports = workflowReportCounts(run.reports);
  const active = run.activeSteps?.map((step) => step.name).join(", ");
  const latest = run.latestReport ? workflowReportGlyph(run.latestReport.type) : null;
  return (
    <ThreadHoverCard title={title} wide footer={footer}>
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
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{run.hid ?? run.runId}</span>
        <CopyValueButton value={run.hid ?? run.runId} label="Copy workflow ID" />
      </span>
      <div aria-hidden className="h-px bg-border/65" />
      {run.definitionName && run.definitionName !== title ? (
        <DetailRow icon={WorkflowIcon} label="Workflow">
          {run.definitionName}
        </DetailRow>
      ) : null}
      {run.projectName || run.projectPath ? (
        <DetailRow icon={FolderIcon} label="Project" wrap>
          {run.projectName || run.projectPath?.split("/").findLast(Boolean)}
          {run.projectPath ? (
            <span className="block wrap-anywhere text-muted-foreground">{run.projectPath}</span>
          ) : null}
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
      {attached ? (
        <DetailRow icon={LinkIcon} label="Link">
          {WORKFLOW_RELATIONSHIP_LABELS[run.relationship]}, {SOURCE_LABELS[run.source]}
        </DetailRow>
      ) : null}
    </ThreadHoverCard>
  );
}
