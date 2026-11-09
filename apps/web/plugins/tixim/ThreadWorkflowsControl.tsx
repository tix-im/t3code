import { RegistryContext } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ThreadId,
  type TiximWorkflowRun,
  TiximWorkflowRelationship,
  WS_METHODS,
} from "@t3tools/contracts";
import { runStreamGuarded } from "@t3tools/client-runtime/rpc";
import {
  createPermissionAwareRuntimeCommand,
  runAtomCommand,
  runStreamInEnvironment,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { useContext, useEffect, useRef, useState } from "react";
import {
  connectionAtomRuntime,
  useEnvironmentQuery,
  useAtomCommand,
  Dialog,
  DialogPopup,
  DialogTitle,
  Button,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSeparator,
  MenuRadioGroup,
  MenuRadioItem,
  ThreadDetailsSection,
} from "../../src/plugins/host";
import {
  WorkflowIcon,
  PlusIcon,
  EllipsisIcon,
  SearchIcon,
  PlugIcon,
  RefreshCwIcon,
} from "lucide-react";
import { workflowEnvironment } from "./state";

const terminal = new Set(["completed", "failed", "cancelled", "skipped"]);
const isRelationship = Schema.is(TiximWorkflowRelationship);
const relationshipLabels: Record<TiximWorkflowRelationship, string> = {
  owner: "Owner",
  tracking: "Tracking",
  waiting_on: "Waiting on",
  untracked: "Untracked",
};
const statusColors: Record<string, string> = {
  pending: "text-warning",
  queued: "text-warning",
  running: "text-info",
  paused: "text-warning",
  suspended: "text-warning",
  completed: "text-success",
  failed: "text-destructive",
};
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
      className="min-h-0 w-full flex-1 border-0 bg-background"
      src={`/tix-flow/index.html#/runs/${encodeURIComponent(run.runId)}`}
    />
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
  const [connectionId, setConnectionId] = useState("");
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [relationship, setRelationship] = useState<TiximWorkflowRelationship>("untracked");
  const [attaching, setAttaching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the debounce timer while the search input changes or unmounts.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const live = useEnvironmentQuery(
    isServerThread
      ? workflowEnvironment.tiximWorkflows({ environmentId, input: { threadId } })
      : null,
  );
  const connections = live.data?.connections ?? [];
  const selectedConnection =
    connections.find((value) => value.id === connectionId) ??
    connections.find((value) => value.available) ??
    connections[0];
  const currentConnection = selectedConnection?.id ?? "";
  const connectionLoading = live.isPending || selectedConnection?.loading === true;
  const connectionDescription = selectedConnection
    ? `${selectedConnection.label} · ${connectionLoading ? "Loading workflows" : selectedConnection.available ? "Connected" : "Unavailable"}`
    : live.isPending
      ? "Loading connections"
      : "No connections configured";
  const search = useEnvironmentQuery(
    attaching && selectedConnection?.available && !connectionLoading
      ? workflowEnvironment.tiximWorkflowSearch({
          environmentId,
          input: {
            threadId,
            connectionId: currentConnection,
            query: searchQuery,
            mentionedOnly: searchQuery === "",
          },
        })
      : null,
  );
  const changeLink = useAtomCommand(workflowEnvironment.tiximWorkflowLink, {
    reportFailure: false,
  });
  const runs = live.data?.runs ?? [];
  const active = runs.filter(
    (run) => run.availability === "available" && !terminal.has(run.state),
  ).length;
  const attention = runs.some((run) => run.attention);
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = run.availability === "available" ? run.state : "unavailable";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const statusSummary = Array.from(counts, ([status, count]) => `${count} ${status}`).join(", ");
  const statusCounts = Array.from(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => (
      <span
        key={status}
        className={`text-xs tabular-nums ${statusColors[status] ?? "text-muted-foreground"}`}
      >
        <span aria-hidden>{count}</span>
        <span className="sr-only">
          {count} {status}
        </span>
      </span>
    ));
  const mutate = async (
    run: TiximWorkflowRun,
    attach: boolean,
    nextRelationship?: TiximWorkflowRelationship,
  ) => {
    setBusy(true);
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
    setBusy(false);
    if (result._tag === "Failure")
      setError("Could not update the workflow link. Check the connection and your permissions.");
    else {
      setAttaching(false);
      live.refresh();
    }
  };
  const row = (run: TiximWorkflowRun, depth = 0) => (
    <div
      key={`${run.daemonId}/${run.runId}`}
      className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/40"
      style={{ marginLeft: depth * 16 }}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={run.availability !== "available"}
        onClick={() => setSelected(run)}
      >
        <strong className="block truncate text-sm">{run.name || run.runId}</strong>
        <span className="text-xs text-muted-foreground">
          <span className={run.availability === "available" ? statusColors[run.state] : undefined}>
            {run.availability === "available" ? run.state : "Unavailable"}
          </span>{" "}
          · {run.relationship.replaceAll("_", " ")} · {run.source.replaceAll("_", " ")} ·{" "}
          {run.startedAt ? new Date(run.startedAt * 1000).toLocaleString() : "Not started"}
          {run.finishedAt ? ` → ${new Date(run.finishedAt * 1000).toLocaleString()}` : ""}
        </span>
      </button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={busy}
              aria-label={`Manage ${run.name || run.runId}`}
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end">
          {TiximWorkflowRelationship.literals.map((value) => (
            <MenuItem
              key={value}
              disabled={run.relationship === value || run.availability !== "available"}
              onClick={() => void mutate(run, true, value)}
            >
              {relationshipLabels[value]}
              {run.relationship === value ? " ✓" : ""}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => void mutate(run, false)}>Detach</MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
  const group = (hosting: boolean) => {
    const values = runs.filter((run) => (run.source === "agent_session") === hosting);
    const seen = new Set<string>();
    const result: React.ReactNode[] = [];
    const visit = (run: TiximWorkflowRun, depth: number) => {
      const key = `${run.daemonId}/${run.runId}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(row(run, Math.min(depth, 8)));
      for (const child of values)
        if (child.daemonId === run.daemonId && child.parentRunId === run.runId)
          visit(child, depth + 1);
    };
    for (const run of values)
      if (
        !values.some((other) => other.daemonId === run.daemonId && other.runId === run.parentRunId)
      )
        visit(run, 0);
    for (const run of values) visit(run, 0);
    return result.length ? result : <p className="text-sm text-muted-foreground">None attached.</p>;
  };
  const candidates =
    search.data?.runs.filter(
      (candidate) =>
        !runs.some((run) => run.daemonId === candidate.daemonId && run.runId === candidate.runId),
    ) ?? [];
  const attachControl = (
    <Popover open={attaching} onOpenChange={setAttaching}>
      <PopoverTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!isServerThread}
            aria-label="Attach workflow"
            title="Attach workflow"
          />
        }
      >
        <PlusIcon aria-hidden />
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80 max-w-[calc(100vw-2rem)]" padding="compact">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Attach workflow</PopoverTitle>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Tixim connection"
                    title={`Tixim connection: ${connectionDescription}`}
                  />
                }
              >
                <span className="relative" aria-hidden>
                  <PlugIcon />
                  <span
                    className={`absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-popover ${connectionLoading ? "bg-warning" : selectedConnection?.available ? "bg-success" : "bg-destructive"}`}
                  />
                </span>
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuRadioGroup
                  value={currentConnection}
                  onValueChange={(id) => {
                    setConnectionId(id);
                    const next = connections.find((value) => value.id === id);
                    if (next && !next.available && !next.loading) live.refresh();
                  }}
                  aria-label="Tixim connections"
                >
                  {connections.map((value) => (
                    <MenuRadioItem key={value.id} value={value.id}>
                      <span className="block">{value.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {value.loading
                          ? "Loading workflows…"
                          : value.available
                            ? "Connected"
                            : "Unavailable"}
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                {connections.length === 0 && <MenuItem disabled>{connectionDescription}</MenuItem>}
                <MenuSeparator />
                <MenuItem disabled={connectionLoading} onClick={live.refresh}>
                  <RefreshCwIcon aria-hidden /> Reload connections
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
          <div className="flex items-center gap-2 rounded border px-2">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              aria-label="Search workflow runs"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
              placeholder="Search by name or run ID…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Relationship
            <select
              className="rounded border bg-background px-2 py-1 text-foreground"
              value={relationship}
              onChange={(event) => {
                const value = event.target.value;
                if (isRelationship(value)) setRelationship(value);
              }}
            >
              {TiximWorkflowRelationship.literals.toReversed().map((value) => (
                <option key={value} value={value}>
                  {relationshipLabels[value]}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {search.error && (
            <p role="alert" className="text-xs text-destructive">
              {search.error}
            </p>
          )}
          {live.error && (
            <p role="alert" className="text-xs text-destructive">
              {live.error}
            </p>
          )}
          {connectionLoading ? (
            <p role="status" className="text-xs text-muted-foreground">
              {selectedConnection
                ? `Loading workflows from ${selectedConnection.label}…`
                : "Loading connections…"}
            </p>
          ) : !currentConnection ? (
            <p className="text-xs text-muted-foreground">
              Configure a Tixim connection in Settings.
            </p>
          ) : !selectedConnection?.available ? (
            <div className="space-y-1">
              <p role="alert" className="text-xs text-muted-foreground">
                {selectedConnection?.label}:{" "}
                {selectedConnection?.error ??
                  "Connection unavailable. Check the connection and your permissions."}
              </p>
              <Button size="xs" variant="ghost" onClick={live.refresh}>
                <RefreshCwIcon aria-hidden /> Retry connection
              </Button>
            </div>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              <p className="pb-1 text-xs font-medium text-muted-foreground">
                {searchQuery ? "Matching workflows" : "Mentioned in this chat"}
              </p>
              {search.isPending || searchQuery !== query.trim() ? (
                <p className="text-xs text-muted-foreground">Searching…</p>
              ) : candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {searchQuery
                    ? "No unattached workflows found."
                    : "No unattached mentions found. Search by name or exact wf-… run ID."}
                </p>
              ) : (
                candidates.map((run) => (
                  <button
                    key={`${run.daemonId}/${run.runId}`}
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate(run, true, relationship)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{run.name || run.runId}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {run.runId} · <span className={statusColors[run.state]}>{run.state}</span>
                      </span>
                    </div>
                    <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
  const overview = (
    <div
      data-plugin-thread-details-list
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto"
      style={displayMode === "panel" ? { maxHeight: 360 } : undefined}
    >
      {(error || live.error) && <p role="alert">{error || live.error}</p>}
      {live.isPending && !live.data && <p>Loading workflows…</p>}
      {displayMode === "header" && <div className="flex justify-end">{attachControl}</div>}
      <h3 className="font-semibold">Agent sessions</h3>
      {group(true)}
      <h3 className="font-semibold">Task workflows</h3>
      {group(false)}
    </div>
  );
  return (
    <>
      {displayMode === "panel" ? (
        <ThreadDetailsSection
          headingId="thread-details-workflows-heading"
          title="Workflows"
          actions={
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger render={<div className="flex items-center gap-1.5" />}>
                  {statusCounts}
                </TooltipTrigger>
                <TooltipPopup>{statusSummary || "No workflows attached"}</TooltipPopup>
              </Tooltip>
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
            {statusCounts}
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
          <DialogTitle>Thread workflows</DialogTitle>
          {selected ? (
            <>
              <Button className="self-start" variant="ghost" onClick={() => setSelected(null)}>
                {displayMode === "panel" ? "← Thread details" : "← Workflow overview"}
              </Button>
              <FlowFrame environmentId={environmentId} threadId={threadId} run={selected} />
            </>
          ) : (
            overview
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
}
