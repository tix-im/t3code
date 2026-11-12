import type {
  EnvironmentId,
  ThreadId,
  TiximWorkflowRelationship,
  TiximWorkflowRun,
} from "@t3tools/contracts";
import { AlarmClockIcon, ArrowLeftIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Button,
  cn,
  CopyValueButton,
  Dialog,
  DialogPopup,
  DialogTitle,
  Popover,
  PopoverPopup,
  PopoverTrigger,
  ThreadDetailsSection,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  useAtomCommand,
  useEnvironmentQuery,
} from "../../src/plugins/host";
import { FlowFrame } from "./FlowFrame";
import { workflowEnvironment } from "./state";
import {
  WORKFLOW_RUN_ACTION_LABELS,
  workflowRunAction,
  type WorkflowRunAction,
} from "./workflowActions";
import { WorkflowAttachPicker } from "./WorkflowAttachPicker";
import { WorkflowRunRow } from "./WorkflowRunRow";
import { WorkflowTally } from "./WorkflowTally";
import {
  isFinishedWorkflowState,
  orderedRuns,
  WORKFLOW_TONE_CLASS,
  workflowRunCounts,
  workflowRunKey,
  workflowRunTitle,
  workflowStateGlyph,
} from "./workflowPresentation";

export function DialogRunTitle({ run }: { run: TiximWorkflowRun }) {
  const glyph = workflowStateGlyph(run.availability === "available" ? run.state : "unavailable");
  const { icon: Icon } = glyph;
  const title = workflowRunTitle(run);
  const id = run.hid ?? run.runId;
  return (
    <>
      <Icon aria-hidden className={cn("size-4 shrink-0", WORKFLOW_TONE_CLASS[glyph.tone])} />
      {/* Names repeat across runs, so the ID stays whole and only the name truncates. */}
      <DialogTitle className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2 py-0.5">
          {title === id ? null : <span className="min-w-0 truncate">{title}</span>}{" "}
          <span className="shrink-0 font-mono text-sm font-normal text-muted-foreground">{id}</span>
        </span>
      </DialogTitle>
      <CopyValueButton value={id} label="Copy workflow ID" />
      <span className={cn("shrink-0 text-xs", WORKFLOW_TONE_CLASS[glyph.tone])}>{glyph.label}</span>
    </>
  );
}

export function ThreadWorkflowsControl({
  environmentId,
  threadId,
  isServerThread,
  displayMode = "header",
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  isServerThread: boolean;
  displayMode?: "header" | "panel";
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TiximWorkflowRun | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useEnvironmentQuery(
    isServerThread
      ? workflowEnvironment.tiximWorkflows({ environmentId, input: { threadId } })
      : null,
  );
  const changeLink = useAtomCommand(workflowEnvironment.tiximWorkflowLink, {
    reportFailure: false,
  });
  const changeSnooze = useAtomCommand(workflowEnvironment.tiximWorkflowSnooze, {
    reportFailure: false,
  });
  const runAction = useAtomCommand(workflowRunAction, { reportFailure: false });
  const [confirming, setConfirming] = useState<{
    run: TiximWorkflowRun;
    action: WorkflowRunAction;
  } | null>(null);
  const [snoozeBusy, setSnoozeBusy] = useState(false);
  const [requestedSnooze, setRequestedSnooze] = useState<{
    value: boolean;
    settledAt: number | null;
  } | null>(null);
  const connections = live.data?.connections ?? [];
  const runs = live.data?.runs ?? [];
  // A subscription reports pending on every emission, so only missing data means loading.
  const loading = live.isPending && live.data === null;
  const counts = workflowRunCounts(runs);
  const statusSummary = counts.map(({ count, label }) => `${count} ${label}`).join(", ");
  const active = runs.filter(
    (run) => run.availability === "available" && !isFinishedWorkflowState(run.state),
  ).length;
  const attention = runs.some((run) => run.attention);
  const mutate = async (
    run: TiximWorkflowRun,
    attach: boolean,
    nextRelationship?: TiximWorkflowRelationship,
  ) => {
    setBusyKey(workflowRunKey(run));
    setError(null);
    const result = await changeLink({
      environmentId,
      input: {
        threadId,
        connectionId: run.connectionId,
        daemonId: run.daemonId,
        runId: run.runId,
        attach,
        ...(nextRelationship === undefined ? {} : { relationship: nextRelationship }),
      },
    });
    setBusyKey(null);
    if (result._tag === "Failure")
      setError("Could not update the workflow link. Check the connection and your permissions.");
    else {
      setAttaching(false);
      live.refresh();
    }
  };
  const act = async (run: TiximWorkflowRun, action: WorkflowRunAction) => {
    setConfirming(null);
    setBusyKey(workflowRunKey(run));
    setError(null);
    const result = await runAction({
      environmentId,
      threadId,
      connectionId: run.connectionId,
      daemonId: run.daemonId,
      runId: run.runId,
      action,
    });
    setBusyKey(null);
    if (result._tag === "Failure")
      setError(
        `Could not ${WORKFLOW_RUN_ACTION_LABELS[action].toLowerCase()} ${workflowRunTitle(run)}. Check the connection and your permissions.`,
      );
    live.refresh();
  };
  const liveSnoozed = live.data?.snoozed === true;
  // Refreshing would restart the stream and blank every row until the daemons answer, so the
  // requested state shows until the next workflow emission reports it.
  if (
    requestedSnooze?.settledAt != null &&
    (requestedSnooze.value === liveSnoozed || live.dataUpdatedAt > requestedSnooze.settledAt)
  )
    setRequestedSnooze(null);
  const snoozed = requestedSnooze?.value ?? liveSnoozed;
  const awaitable = runs.some(
    (run) => run.source !== "agent_session" && !isFinishedWorkflowState(run.state),
  );
  const toggleSnooze = async () => {
    const snoozing = !snoozed;
    setSnoozeBusy(true);
    setError(null);
    setRequestedSnooze({ value: snoozing, settledAt: null });
    const result = await changeSnooze({ environmentId, input: { threadId, snoozing } });
    setSnoozeBusy(false);
    if (result._tag === "Failure") {
      setRequestedSnooze(null);
      setError("Could not change the snooze. The thread may have a pending request.");
    } else setRequestedSnooze({ value: result.value.status === "snoozed", settledAt: Date.now() });
  };
  const snoozeLabel = snoozed ? "Wake thread now" : "Snooze until workflows finish";
  const snoozeControl =
    snoozed || awaitable ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={!isServerThread || snoozeBusy}
              aria-label={snoozeLabel}
              aria-pressed={snoozed}
              onClick={() => void toggleSnooze()}
            />
          }
        >
          <AlarmClockIcon aria-hidden className={cn(snoozed && "text-info-foreground")} />
        </TooltipTrigger>
        <TooltipPopup>{snoozeLabel}</TooltipPopup>
      </Tooltip>
    ) : null;
  const attachControl = (
    <Popover
      open={attaching}
      onOpenChange={(value) => {
        setAttaching(value);
        if (value) setError(null);
      }}
    >
      <Tooltip disabled={attaching}>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <PopoverTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!isServerThread}
                aria-label="Attach workflow"
              />
            }
          >
            <PlusIcon aria-hidden />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipPopup>Attach workflow</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" width="md" padding="none">
        <WorkflowAttachPicker
          environmentId={environmentId}
          threadId={threadId}
          connections={connections}
          connectionsError={live.error}
          connectionsLoading={loading || connections.some((value) => value.loading)}
          attached={runs}
          attachingKey={busyKey}
          error={error}
          onAttach={(run, relationship) => void mutate(run, true, relationship)}
          onRefresh={live.refresh}
        />
      </PopoverPopup>
    </Popover>
  );
  const runList = (items: ReturnType<typeof orderedRuns>) => (
    <ul className="m-0 list-none p-0">
      {items.map((entry) => (
        <WorkflowRunRow
          key={workflowRunKey(entry.run)}
          environmentId={environmentId}
          threadId={threadId}
          run={entry.run}
          tree={entry}
          refreshing={connections.some(
            (value) => value.id === entry.run.connectionId && value.loading,
          )}
          busy={busyKey !== null}
          onOpen={setSelected}
          onRelationshipChange={(target, value) => void mutate(target, true, value)}
          onDetach={(target) => void mutate(target, false)}
          onAction={(target, action) => {
            if (action === "cancel" || action === "restart") setConfirming({ run: target, action });
            else void act(target, action);
          }}
        />
      ))}
    </ul>
  );
  const groupHeading = (title: string) => (
    <h4 className="m-0 px-2.5 pt-1.5 pb-0.5 text-2xs font-medium text-muted-foreground select-none">
      {title}
    </h4>
  );
  const hosting = orderedRuns(runs.filter((run) => run.source === "agent_session"));
  const tasks = orderedRuns(runs.filter((run) => run.source !== "agent_session"));
  const bothGroups = hosting.length > 0 && tasks.length > 0;
  const nothingToShow =
    displayMode === "panel" && runs.length === 0 && connections.length === 0 && !live.error;
  const alert = live.error ?? (attaching ? null : error);
  const overview = (
    <div
      data-plugin-thread-details-list
      className="flex min-h-0 flex-1 flex-col overflow-auto"
      style={displayMode === "panel" ? { maxHeight: 360 } : undefined}
    >
      {nothingToShow ? null : (
        <>
          {alert ? (
            <p role="alert" className="m-0 px-2.5 py-1 text-xs text-destructive-foreground">
              {alert}
            </p>
          ) : null}
          {loading && displayMode === "header" ? (
            <p role="status" className="m-0 px-2.5 py-1 text-xs text-muted-foreground">
              Loading workflows…
            </p>
          ) : null}
          {hosting.length > 0 ? (
            <>
              {bothGroups ? groupHeading("Agent sessions") : null}
              {runList(hosting)}
            </>
          ) : null}
          {tasks.length > 0 ? (
            <>
              {bothGroups ? groupHeading("Task workflows") : null}
              {runList(tasks)}
            </>
          ) : null}
          {runs.length === 0 && !alert && !loading ? (
            <p className="m-0 px-2.5 py-1 text-xs text-muted-foreground">No workflows attached</p>
          ) : null}
        </>
      )}
    </div>
  );
  const selectedRun = selected
    ? (runs.find((run) => workflowRunKey(run) === workflowRunKey(selected)) ?? selected)
    : null;
  return (
    <>
      {displayMode === "panel" ? (
        <ThreadDetailsSection
          headingId="thread-details-workflows-heading"
          title="Workflows"
          actions={
            <div className="flex items-center gap-1.5">
              {counts.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex text-2xs" />}>
                    <WorkflowTally counts={counts} />
                  </TooltipTrigger>
                  <TooltipPopup>{statusSummary}</TooltipPopup>
                </Tooltip>
              ) : null}
              {snoozeControl}
              {attachControl}
            </div>
          }
        >
          {overview}
        </ThreadDetailsSection>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(true)}
                aria-label={`Workflows, ${active} active${statusSummary ? `, ${statusSummary}` : ""}${attention ? ", needs attention" : ""}`}
              />
            }
          >
            <WorkflowIcon className="size-4" aria-hidden />
            <WorkflowTally counts={counts} />
            {attention && <span className="size-1.5 rounded-full bg-warning" aria-hidden />}
          </TooltipTrigger>
          <TooltipPopup>
            Workflows{statusSummary ? `: ${statusSummary}` : ": none attached"}
            {attention ? " · needs attention" : ""}
          </TooltipPopup>
        </Tooltip>
      )}
      <Dialog
        open={displayMode === "panel" ? selected !== null : open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setSelected(null);
            setAttaching(false);
          }
        }}
      >
        <DialogPopup className="flex h-[85vh] w-[min(1200px,95vw)] max-w-none flex-col">
          <div className="flex min-w-0 items-center gap-2.5 border-b border-border/65 py-2.5 ps-4 pe-12">
            {selected && displayMode === "header" ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Back to workflow overview"
                onClick={() => setSelected(null)}
              >
                <ArrowLeftIcon aria-hidden />
              </Button>
            ) : null}
            {selectedRun ? (
              <DialogRunTitle run={selectedRun} />
            ) : (
              <>
                <DialogTitle className="min-w-0 flex-1">Thread workflows</DialogTitle>
                {snoozeControl}
                {attachControl}
              </>
            )}
          </div>
          {selected ? (
            <FlowFrame
              key={workflowRunKey(selected)}
              environmentId={environmentId}
              threadId={threadId}
              connectionId={selected.connectionId}
              daemonId={selected.daemonId}
              title={`Tix Flow: ${selected.name}`}
              path={`/runs/${encodeURIComponent(selected.runId)}`}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col p-2">{overview}</div>
          )}
        </DialogPopup>
      </Dialog>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(value) => {
          if (!value) setConfirming(null);
        }}
      >
        {confirming ? (
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirming.action === "cancel" ? "Cancel" : "Restart"}{" "}
                {workflowRunTitle(confirming.run)}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirming.action === "cancel"
                  ? "Running steps stop and the run cannot be resumed."
                  : "Tixim starts the run again with the same arguments."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>Keep it</AlertDialogClose>
              <Button
                variant={confirming.action === "cancel" ? "destructive" : "default"}
                onClick={() => void act(confirming.run, confirming.action)}
              >
                {WORKFLOW_RUN_ACTION_LABELS[confirming.action]}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        ) : null}
      </AlertDialog>
    </>
  );
}
