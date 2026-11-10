import { RegistryContext } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ThreadId,
  type TiximWorkflowRelationship,
  type TiximWorkflowRun,
  WS_METHODS,
} from "@t3tools/contracts";
import { runStreamGuarded } from "@t3tools/client-runtime/rpc";
import {
  createPermissionAwareRuntimeCommand,
  runAtomCommand,
  runStreamInEnvironment,
} from "@t3tools/client-runtime/state/runtime";
import { htmlRenderThemeMessage } from "@t3tools/shared/htmlRender";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AlarmClockIcon, ArrowLeftIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  cn,
  connectionAtomRuntime,
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
  useHtmlRenderTheme,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";
import { WorkflowAttachPicker } from "./WorkflowAttachPicker";
import { WorkflowRunRow } from "./WorkflowRunRow";
import { WorkflowTally } from "./WorkflowTally";
import {
  isFinishedWorkflowState,
  WORKFLOW_TONE_CLASS,
  workflowRunCounts,
  workflowRunKey,
  workflowRunTitle,
  workflowStateGlyph,
} from "./workflowPresentation";

const writeMethods = new Set([
  "CancelWorkflow",
  "SuspendWorkflowRun",
  "ResumeWorkflowRun",
  "FreezeWorkflowRun",
  "ThawWorkflowRun",
  "RestartWorkflowRun",
  "SetWorkflowTitle",
  "SetWorkflowMeta",
  "SubmitPendingApproval",
  "AnswerWorkflowInput",
  "TopUpRunBudget",
  "MutatePlannerDag",
]);
const bridge = createPermissionAwareRuntimeCommand(connectionAtomRuntime, {
  label: "tix-flow transport",
  execute: (input: {
    environmentId: EnvironmentId;
    threadId: ThreadId;
    run: TiximWorkflowRun;
    method: string;
    body: string;
    signal: AbortSignal;
    chunk: (value: string) => void;
  }) => {
    const tag = writeMethods.has(input.method.split("/")[1] ?? "")
      ? WS_METHODS.tiximFlowWrite
      : WS_METHODS.tiximFlowRead;
    const request = runStreamInEnvironment(
      input.environmentId,
      runStreamGuarded(tag, {
        threadId: input.threadId,
        connectionId: input.run.connectionId,
        daemonId: input.run.daemonId,
        method: input.method,
        body: input.body,
      }),
    ).pipe(Stream.runForEach((value) => Effect.sync(() => input.chunk(value))));
    const cancelled = Effect.callback<void>((resume) => {
      const abort = () => resume(Effect.void);
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
      return Effect.sync(() => input.signal.removeEventListener("abort", abort));
    });
    return Effect.raceFirst(request, cancelled);
  },
});

function send(port: MessagePort | undefined, value: unknown) {
  port?.postMessage(value);
}
function encoded(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function decoded(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function FlowFrame({
  environmentId,
  threadId,
  run,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  run: TiximWorkflowRun;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const registry = useContext(RegistryContext);
  const theme = useHtmlRenderTheme();
  const [loads, setLoads] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Posts the theme to the sandboxed iframe on each load and change, kept apart from the effect below so a theme change does not abort its streams.
  useEffect(() => {
    if (loads > 0) frame.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  }, [loads, theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the iframe message port and its cancellable RPC streams alive only while this run view is mounted.
  useEffect(() => {
    const pending = new Map<number, AbortController>();
    let port: MessagePort | undefined;
    const stop = () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      port?.close();
    };
    const ready = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "t3-flow-ready"
      )
        return;
      stop();
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (message) => {
        const value = message.data;
        if (!Number.isSafeInteger(value?.id)) return;
        if (value.type === "cancel") {
          pending.get(value.id)?.abort();
          pending.delete(value.id);
          return;
        }
        if (
          value.type !== "request" ||
          typeof value.method !== "string" ||
          !(value.bytes instanceof Uint8Array) ||
          value.bytes.length > 8 * 1024 * 1024 ||
          pending.has(value.id)
        )
          return;
        const controller = new AbortController();
        pending.set(value.id, controller);
        const target = port;
        void runAtomCommand(
          registry,
          bridge,
          {
            environmentId,
            threadId,
            run,
            method: value.method,
            body: encoded(value.bytes),
            signal: controller.signal,
            chunk: (text) => send(target, { type: "chunk", id: value.id, bytes: decoded(text) }),
          },
          { reportFailure: false, reportDefect: false },
        ).then((result) => {
          pending.delete(value.id);
          send(target, { type: result._tag === "Success" ? "end" : "error", id: value.id });
        });
      };
      port.start();
      frame.current?.contentWindow?.postMessage({ type: "t3-flow-port" }, "*", [channel.port2]);
      setLoads((count) => count + 1);
    };
    window.addEventListener("message", ready);
    return () => {
      window.removeEventListener("message", ready);
      stop();
    };
  }, [registry, environmentId, threadId, run]);
  return (
    <iframe
      ref={frame}
      title={`Tix Flow: ${run.name}`}
      sandbox="allow-scripts"
      className={cn("min-h-0 w-full flex-1 border-0 bg-background", loads === 0 && "invisible")}
      style={{ colorScheme: theme.appearance }}
      src={`/tix-flow/index.html#/runs/${encodeURIComponent(run.runId)}`}
    />
  );
}

function DialogRunTitle({ run }: { run: TiximWorkflowRun }) {
  const glyph = workflowStateGlyph(run.availability === "available" ? run.state : "unavailable");
  const { icon: Icon } = glyph;
  return (
    <>
      <Icon aria-hidden className={cn("size-4 shrink-0", WORKFLOW_TONE_CLASS[glyph.tone])} />
      <DialogTitle className="min-w-0">
        <span className="block truncate py-0.5">{workflowRunTitle(run)}</span>
      </DialogTitle>
      <span className={cn("shrink-0 text-xs", WORKFLOW_TONE_CLASS[glyph.tone])}>{glyph.label}</span>
    </>
  );
}

function orderedRuns(runs: ReadonlyArray<TiximWorkflowRun>) {
  const sorted = runs.toSorted(
    (a, b) =>
      Number(isFinishedWorkflowState(a.state)) - Number(isFinishedWorkflowState(b.state)) ||
      (b.submittedAt ?? 0) - (a.submittedAt ?? 0),
  );
  const seen = new Set<string>();
  const ordered: Array<{ run: TiximWorkflowRun; depth: number }> = [];
  const visit = (run: TiximWorkflowRun, depth: number) => {
    const key = workflowRunKey(run);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ run, depth: Math.min(depth, 4) });
    for (const child of sorted)
      if (child.daemonId === run.daemonId && child.parentRunId === run.runId)
        visit(child, depth + 1);
  };
  for (const run of sorted)
    if (!sorted.some((other) => other.daemonId === run.daemonId && other.runId === run.parentRunId))
      visit(run, 0);
  // A parent cycle has no root, and its runs must still be listed.
  for (const run of sorted) visit(run, 0);
  return ordered;
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
  const [snoozeBusy, setSnoozeBusy] = useState(false);
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
  const snoozed = live.data?.snoozed === true;
  const awaitable = runs.some(
    (run) => run.source !== "agent_session" && !isFinishedWorkflowState(run.state),
  );
  const toggleSnooze = async () => {
    setSnoozeBusy(true);
    setError(null);
    const result = await changeSnooze({
      environmentId,
      input: { threadId, snoozing: !snoozed },
    });
    setSnoozeBusy(false);
    if (result._tag === "Failure")
      setError("Could not change the snooze. The thread may have a pending request.");
    else live.refresh();
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
      {items.map(({ run, depth }) => (
        <WorkflowRunRow
          key={workflowRunKey(run)}
          run={run}
          depth={depth}
          refreshing={connections.some((value) => value.id === run.connectionId && value.loading)}
          busy={busyKey !== null}
          onOpen={setSelected}
          onRelationshipChange={(target, value) => void mutate(target, true, value)}
          onDetach={(target) => void mutate(target, false)}
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
              run={selected}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col p-2">{overview}</div>
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
}
