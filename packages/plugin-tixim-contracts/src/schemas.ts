import * as Schema from "effect/Schema";

export const TiximContext = Schema.Struct({
  /** Empty selects the environment's current context (or its run's daemon). */
  name: Schema.String,
  label: Schema.String,
  url: Schema.String,
  status: Schema.String,
  current: Schema.Boolean,
});
export type TiximContext = typeof TiximContext.Type;

export const TiximListContextsInput = Schema.Struct({});
export type TiximListContextsInput = typeof TiximListContextsInput.Type;

export const TiximListContextsResult = Schema.Struct({
  contexts: Schema.Array(TiximContext),
});
export type TiximListContextsResult = typeof TiximListContextsResult.Type;

const TiximIconFill = Schema.Struct({ light: Schema.String, dark: Schema.String });
const TiximIcon = Schema.Struct({
  viewBox: Schema.String,
  fill: TiximIconFill,
  paths: Schema.Array(
    Schema.Struct({
      d: Schema.String,
      fillRule: Schema.optional(Schema.Literals(["evenodd", "nonzero"])),
      fill: Schema.optional(TiximIconFill),
    }),
  ),
});

/** tixim's harness icon standard: the brand's own logo and its TiX-merged variant. */
export const TiximHarnessIcon = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  plain: TiximIcon,
  tixim: TiximIcon,
});
export type TiximHarnessIcon = typeof TiximHarnessIcon.Type;

export const TiximHarness = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  authenticated: Schema.Boolean,
  /** Absent on daemons older than the harness icon standard. */
  icon: Schema.optional(TiximHarnessIcon),
});
export type TiximHarness = typeof TiximHarness.Type;

export const TiximListHarnessesInput = Schema.Struct({
  context: Schema.String,
});
export type TiximListHarnessesInput = typeof TiximListHarnessesInput.Type;

export const TiximListHarnessesResult = Schema.Struct({
  /** Only harnesses that speak ACP, the ones a Tixim instance can run. */
  harnesses: Schema.Array(TiximHarness),
});
export type TiximListHarnessesResult = typeof TiximListHarnessesResult.Type;

export const TiximListModelsInput = Schema.Struct({
  context: Schema.String,
  harness: Schema.String,
  routing: Schema.Literals(["default", "gateway", "native"]),
});
export type TiximListModelsInput = typeof TiximListModelsInput.Type;
export const TiximListModelsResult = Schema.Struct({
  models: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type TiximListModelsResult = typeof TiximListModelsResult.Type;

export class TiximCommandError extends Schema.TaggedError<TiximCommandError>()(
  "TiximCommandError",
  {
    message: Schema.String,
  },
) {}

export const TiximWorkflowRelationship = Schema.Literals([
  "owner",
  "tracking",
  "waiting_on",
  "untracked",
]);
export type TiximWorkflowRelationship = typeof TiximWorkflowRelationship.Type;

const TiximWorkflowStepCounts = Schema.Struct({
  running: Schema.Number,
  failed: Schema.Number,
  /** Already includes `queued`. */
  waiting: Schema.Number,
  queued: Schema.Number,
  succeeded: Schema.Number,
  skipped: Schema.Number,
});
const TiximWorkflowReportCounts = Schema.Struct({
  info: Schema.Number,
  success: Schema.Number,
  warning: Schema.Number,
  failure: Schema.Number,
});
/** Optional because saved links and older daemons have none of these. */
export const TiximWorkflowRunDetails = {
  hid: Schema.optional(Schema.String),
  definitionName: Schema.optional(Schema.String),
  statusMessage: Schema.optional(Schema.String),
  waitingReason: Schema.optional(Schema.String),
  pendingInputCount: Schema.optional(Schema.Number),
  steps: Schema.optional(TiximWorkflowStepCounts),
  reports: Schema.optional(TiximWorkflowReportCounts),
  latestReport: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      message: Schema.String,
      createdAt: Schema.optional(Schema.Number),
    }),
  ),
  activeSteps: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String })),
  ),
};

export const TiximWorkflowRun = Schema.Struct({
  daemonId: Schema.String,
  connectionId: Schema.String,
  runId: Schema.String,
  name: Schema.String,
  state: Schema.String,
  parentRunId: Schema.String,
  submittedAt: Schema.NullOr(Schema.Number),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  attention: Schema.Boolean,
  source: Schema.Literals(["agent_session", "automatic", "manual"]),
  relationship: TiximWorkflowRelationship,
  availability: Schema.Literals(["available", "unavailable"]),
  ...TiximWorkflowRunDetails,
});
export type TiximWorkflowRun = typeof TiximWorkflowRun.Type;
export const TiximWorkflowListInput = Schema.Struct({ threadId: Schema.String });
export const TiximWorkflowConnection = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  daemonId: Schema.String,
  available: Schema.Boolean,
  loading: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
});
export type TiximWorkflowConnection = typeof TiximWorkflowConnection.Type;
export const TiximWorkflowListResult = Schema.Struct({
  runs: Schema.Array(TiximWorkflowRun),
  connections: Schema.Array(TiximWorkflowConnection),
  /** The thread is snoozed until its attached workflows settle. */
  snoozed: Schema.optional(Schema.Boolean),
});
export const TiximWorkflowSearchInput = Schema.Struct({
  threadId: Schema.String,
  connectionId: Schema.String,
  query: Schema.String,
  mentionedOnly: Schema.optional(Schema.Boolean),
  /** Ask the daemon to match its full history, which takes seconds instead of milliseconds. */
  includeHistory: Schema.optional(Schema.Boolean),
});
export const TiximWorkflowLinkInput = Schema.Struct({
  threadId: Schema.String,
  connectionId: Schema.String,
  daemonId: Schema.String,
  runId: Schema.String,
  attach: Schema.Boolean,
  relationship: Schema.optional(TiximWorkflowRelationship),
});
export const TiximWorkflowWaitInput = Schema.Struct({
  threadId: Schema.String,
  waiting: Schema.optional(Schema.Boolean),
  relationships: Schema.optional(Schema.Array(TiximWorkflowRelationship)),
  timeoutSeconds: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(2592000)),
  ),
});
export type TiximWorkflowWaitInput = typeof TiximWorkflowWaitInput.Type;
export const TiximWorkflowWaitResult = Schema.Struct({
  status: Schema.Literals(["waiting", "settled", "cancelled"]),
  runCount: Schema.Int,
  deadline: Schema.NullOr(Schema.Number),
  next: Schema.String,
});
export const TiximWorkflowSnoozeInput = Schema.Struct({
  threadId: Schema.String,
  snoozing: Schema.Boolean,
});
export type TiximWorkflowSnoozeInput = typeof TiximWorkflowSnoozeInput.Type;
export const TiximWorkflowSnoozeResult = Schema.Struct({
  status: Schema.Literals(["snoozed", "settled", "cancelled"]),
  runCount: Schema.Int,
});
export const TiximWorkflowNotification = Schema.Struct({
  daemonId: Schema.String,
  runId: Schema.String,
  kind: Schema.Literals(["terminal", "attention"]),
  state: Schema.String,
  createdAt: Schema.Number,
});
export const TiximWorkflowPollResult = Schema.Struct({
  notifications: Schema.Array(TiximWorkflowNotification),
  next: Schema.String,
});
export const TiximFlowRpcInput = Schema.Struct({
  threadId: Schema.String,
  connectionId: Schema.String,
  daemonId: Schema.String,
  method: Schema.String,
  body: Schema.String.check(Schema.isMaxLength(12 * 1024 * 1024)),
});

export type TiximWorkflowLinkInput = typeof TiximWorkflowLinkInput.Type;
export type TiximWorkflowSearchInput = typeof TiximWorkflowSearchInput.Type;
export type TiximFlowRpcInput = typeof TiximFlowRpcInput.Type;

export const DesktopTiximProjectSchema = Schema.Struct({
  project: Schema.String,
  alias: Schema.String,
  directory: Schema.String,
  configured: Schema.Boolean,
});
export type DesktopTiximProject = typeof DesktopTiximProjectSchema.Type;

export interface TiximDesktopBridge {
  discoverTiximProjects?: () => Promise<readonly DesktopTiximProject[]>;
  installTiximSshConfig?: () => Promise<void>;
}
