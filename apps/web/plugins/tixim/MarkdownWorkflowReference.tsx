import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId, TiximWorkflowRun } from "@t3tools/contracts";
import { useContext, useState } from "react";
import { EyeIcon } from "lucide-react";
import {
  useAtomCommand,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  ThreadDetailsControl,
  ThreadHoverCard,
  ThreadHoverCardPopup,
  Tooltip,
  TooltipTrigger,
  useNowMinute,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";
import { WorkflowRunDetails } from "./WorkflowRunDetails";
import { workflowRunElapsed, workflowStateGlyph } from "./workflowPresentation";
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
  const nowSeconds = Date.parse(`${useNowMinute()}:00Z`) / 1000;
  return (
    <Tooltip
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) for (const query of state.queries) registry.refresh(query);
      }}
    >
      <TooltipTrigger
        delay={200}
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
      </TooltipTrigger>
      <ThreadHoverCardPopup className="pointer-events-auto max-w-96">
        {state.runs.length === 0 ? (
          <ThreadHoverCard title={hid}>{status}</ThreadHoverCard>
        ) : (
          state.runs.map((run) => {
            const available = run.availability === "available";
            const linked = state.linked.includes(run);
            return (
              <WorkflowRunDetails
                key={run.daemonId}
                run={run}
                glyph={workflowStateGlyph(available ? run.state : "unavailable")}
                elapsed={available ? workflowRunElapsed(run, nowSeconds) : null}
                attached={linked}
                footer={
                  linked ? undefined : (
                    <div className="border-t border-border/65 pt-1">
                      <ThreadDetailsControl
                        size="sm"
                        variant="ghost"
                        part="row"
                        disabled={!canTrack || busy || !available}
                        onClick={() => void track(run)}
                      >
                        <EyeIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                        <span className="min-w-0 flex-1 truncate text-start">Add to tracking</span>
                      </ThreadDetailsControl>
                    </div>
                  )
                }
              />
            );
          })
        )}
        {state.runs.length > 0 && state.unavailable ? (
          <p className="m-0 px-1 pb-2 text-xs text-muted-foreground">
            Some connections are unavailable.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 px-1 pb-2 text-xs text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </ThreadHoverCardPopup>
    </Tooltip>
  );
}
