import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId, TiximWorkflowRun } from "@t3tools/contracts";
import { useContext, useState } from "react";
import {
  useAtomCommand,
  Button,
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";
import { workflowStateSymbol } from "@t3tools/client-runtime/plugins/tixim/references";

export function MarkdownWorkflowReference({
  environmentId,
  threadId,
  hid,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  hid: string;
}) {
  const registry = useContext(RegistryContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveAtom = workflowEnvironment.tiximWorkflows({ environmentId, input: { threadId } });
  const stateAtom = workflowEnvironment.reference(environmentId)(threadId)(hid);
  const state = useAtomValue(stateAtom);
  const canTrack = useAtomValue(
    workflowEnvironment.tiximWorkflowLink.permissionAtom(environmentId),
  );
  const changeLink = useAtomCommand(workflowEnvironment.tiximWorkflowLink, {
    reportFailure: false,
  });
  const status =
    state.runs.length === 1
      ? state.runs[0]!.availability === "available"
        ? state.runs[0]!.state
        : "Unavailable"
      : state.runs.length > 1
        ? "Multiple daemons"
        : state.loading
          ? "Loading"
          : state.unavailable
            ? "Unavailable"
            : "Not found";
  const track = async (run: TiximWorkflowRun) => {
    setBusy(true);
    setError(null);
    try {
      const result = await changeLink({
        environmentId,
        input: {
          threadId,
          connectionId: run.connectionId,
          daemonId: run.daemonId,
          runId: run.runId,
          attach: true,
          relationship: "tracking",
        },
      });
      if (result._tag === "Failure") setError("Could not add workflow to tracking.");
      else registry.refresh(liveAtom);
    } catch {
      setError("Could not add workflow to tracking.");
    }
    setBusy(false);
  };
  return (
    <PreviewCard
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) for (const query of state.queries) registry.refresh(query);
      }}
    >
      <PreviewCardTrigger
        render={
          <button
            type="button"
            className="inline cursor-pointer text-primary underline decoration-dotted underline-offset-4"
            onClick={() => setOpen(!open)}
          />
        }
        aria-label={`${hid}: ${status}`}
        data-markdown-copy={hid}
      >
        <span aria-hidden>{workflowStateSymbol(status)} </span>
        {hid}
      </PreviewCardTrigger>
      <PreviewCardPopup>
        <div className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3 text-sm">
          <strong className="break-all">{hid}</strong>
          {state.runs.length === 0 ? (
            <p>{status}</p>
          ) : (
            state.runs.map((run) => {
              const linked = state.linked.find((other) => other.daemonId === run.daemonId);
              const runStatus = run.availability === "available" ? run.state : "Unavailable";
              return (
                <div key={run.daemonId} className="space-y-2">
                  <p>{run.name || hid}</p>
                  <p>
                    {workflowStateSymbol(runStatus)} {runStatus}
                    {run.attention ? " · Needs attention" : ""}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {run.connectionId} · {run.daemonId}
                  </p>
                  {linked ? (
                    <p>Attached · {linked.relationship.replaceAll("_", " ")}</p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canTrack || busy || run.availability !== "available"}
                      onClick={() => void track(run)}
                    >
                      Add to tracking
                    </Button>
                  )}
                </div>
              );
            })
          )}
          {state.runs.length > 0 && state.unavailable ? (
            <p>Some connections are unavailable.</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
