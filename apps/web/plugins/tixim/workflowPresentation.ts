import type { TiximWorkflowRelationship, TiximWorkflowRun } from "@t3tools/contracts";
import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleIcon,
  CircleSlashIcon,
  CircleXIcon,
  InfoIcon,
  OctagonAlertIcon,
  OctagonXIcon,
  PauseIcon,
  SnowflakeIcon,
  TriangleAlertIcon,
  UnplugIcon,
  type LucideIcon,
} from "lucide-react";

export type WorkflowTone = "info" | "success" | "warning" | "destructive" | "muted";

export const WORKFLOW_TONE_CLASS: Record<WorkflowTone, string> = {
  info: "text-info-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive-foreground",
  muted: "text-muted-foreground",
};

export interface WorkflowGlyph {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: WorkflowTone;
}

export interface WorkflowCount extends WorkflowGlyph {
  readonly key: string;
  readonly count: number;
}

// Declared attention first: the header tally follows this order.
const RUN_STATES: Record<string, WorkflowGlyph> = {
  failed: { label: "Failed", icon: CircleXIcon, tone: "destructive" },
  blocked: { label: "Blocked", icon: OctagonAlertIcon, tone: "destructive" },
  awaiting_input: { label: "Awaiting input", icon: CircleHelpIcon, tone: "warning" },
  running: { label: "Running", icon: CircleDotIcon, tone: "info" },
  paused: { label: "Paused", icon: PauseIcon, tone: "warning" },
  cancelling: { label: "Cancelling", icon: CircleDashedIcon, tone: "warning" },
  suspending: { label: "Suspending", icon: CircleDashedIcon, tone: "warning" },
  queued: { label: "Queued", icon: CircleDashedIcon, tone: "warning" },
  suspended: { label: "Suspended", icon: PauseIcon, tone: "info" },
  frozen: { label: "Frozen", icon: SnowflakeIcon, tone: "info" },
  pending: { label: "Pending", icon: CircleIcon, tone: "muted" },
  completed: { label: "Completed", icon: CircleCheckIcon, tone: "success" },
  cancelled: { label: "Cancelled", icon: CircleSlashIcon, tone: "muted" },
};
const UNKNOWN_STATE: WorkflowGlyph = { label: "Unknown", icon: CircleIcon, tone: "muted" };
const UNAVAILABLE_STATE: WorkflowGlyph = { label: "Unavailable", icon: UnplugIcon, tone: "muted" };
const STATE_ORDER = [...Object.keys(RUN_STATES), "unavailable"];

export function workflowStateGlyph(state: string): WorkflowGlyph {
  return state === "unavailable" ? UNAVAILABLE_STATE : (RUN_STATES[state] ?? UNKNOWN_STATE);
}

export function isFinishedWorkflowState(state: string): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export const WORKFLOW_RELATIONSHIP_LABELS: Record<TiximWorkflowRelationship, string> = {
  owner: "Owner",
  tracking: "Tracking",
  waiting_on: "Waiting on",
  untracked: "Untracked",
};

export const workflowRunTitle = (run: TiximWorkflowRun) => run.name || run.hid || run.runId;
export const workflowRunKey = (run: Pick<TiximWorkflowRun, "daemonId" | "runId">) =>
  `${run.daemonId}/${run.runId}`;

const present = (counts: ReadonlyArray<WorkflowCount>) => counts.filter((item) => item.count > 0);

/** `waiting` already includes `queued`. The row combines them, and `splitQueued` separates them. */
export function workflowStepCounts(
  steps: TiximWorkflowRun["steps"],
  splitQueued = false,
): WorkflowCount[] {
  if (steps === undefined) return [];
  return present([
    { key: "running", label: "running", icon: CircleDotIcon, tone: "info", count: steps.running },
    {
      key: "failed",
      label: "failed",
      icon: CircleXIcon,
      tone: "destructive",
      count: steps.failed,
    },
    {
      key: "waiting",
      label: "waiting",
      icon: CircleDashedIcon,
      tone: "warning",
      count: splitQueued ? steps.waiting - steps.queued : steps.waiting,
    },
    {
      key: "queued",
      label: "queued",
      icon: CircleDashedIcon,
      tone: "warning",
      count: splitQueued ? steps.queued : 0,
    },
    {
      key: "succeeded",
      label: "done",
      icon: CircleCheckIcon,
      tone: "success",
      count: steps.succeeded,
    },
    {
      key: "skipped",
      label: "skipped",
      icon: CircleSlashIcon,
      tone: "muted",
      count: steps.skipped,
    },
  ]);
}

export function workflowReportCounts(reports: TiximWorkflowRun["reports"]): WorkflowCount[] {
  if (reports === undefined) return [];
  return present([
    {
      key: "failure",
      label: "failure",
      icon: OctagonXIcon,
      tone: "destructive",
      count: reports.failure,
    },
    {
      key: "warning",
      label: "warning",
      icon: TriangleAlertIcon,
      tone: "warning",
      count: reports.warning,
    },
    {
      key: "success",
      label: "success",
      icon: BadgeCheckIcon,
      tone: "success",
      count: reports.success,
    },
    { key: "info", label: "info", icon: InfoIcon, tone: "muted", count: reports.info },
  ]);
}

export function workflowRunCounts(runs: ReadonlyArray<TiximWorkflowRun>): WorkflowCount[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = run.availability === "available" ? run.state : "unavailable";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rank = (key: string) => {
    const index = STATE_ORDER.indexOf(key);
    return index === -1 ? STATE_ORDER.length : index;
  };
  return Array.from(counts, ([key, count]) => {
    const glyph = workflowStateGlyph(key);
    return { key, count, ...glyph, label: glyph.label.toLowerCase() };
  }).sort((a, b) => rank(a.key) - rank(b.key));
}

export function workflowReportGlyph(type: string): Pick<WorkflowGlyph, "icon" | "tone"> {
  switch (type.trim().toLowerCase()) {
    case "failure":
      return { icon: OctagonXIcon, tone: "destructive" };
    case "warning":
      return { icon: TriangleAlertIcon, tone: "warning" };
    case "success":
      return { icon: BadgeCheckIcon, tone: "success" };
    default:
      return { icon: InfoIcon, tone: "muted" };
  }
}

/** What a row says below its counts. Only what asks for attention, the hover card has the rest. */
export function workflowRunNote(
  run: TiximWorkflowRun,
): (Pick<WorkflowGlyph, "icon" | "tone"> & { readonly text: string }) | null {
  if (run.pendingInputCount)
    return {
      icon: CircleHelpIcon,
      tone: "warning",
      text:
        run.pendingInputCount === 1
          ? "Waiting for input"
          : `Waiting for ${run.pendingInputCount} inputs`,
    };
  if (run.latestReport) {
    const glyph = workflowReportGlyph(run.latestReport.type);
    if (glyph.tone === "destructive" || glyph.tone === "warning")
      return { ...glyph, text: run.latestReport.message };
  }
  if (run.state === "failed" && run.statusMessage)
    return { icon: CircleXIcon, tone: "destructive", text: run.statusMessage };
  return null;
}

function formatWorkflowElapsed(seconds: number): string {
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function workflowRunElapsed(run: TiximWorkflowRun, nowSeconds: number): string | null {
  if (run.startedAt === null) return null;
  if (run.finishedAt !== null)
    return `ran ${formatWorkflowElapsed(run.finishedAt - run.startedAt)}`;
  if (isFinishedWorkflowState(run.state)) return null;
  return formatWorkflowElapsed(Math.max(0, nowSeconds - run.startedAt));
}

export function formatWorkflowTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
  });
}
