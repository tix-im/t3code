import type { EnvironmentId, ThreadId, TiximWorkflowRun } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../src/plugins/host";
import { workflowEnvironment } from "./state";

export function WorkflowRunLog({
  environmentId,
  threadId,
  run,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  run: TiximWorkflowRun;
}) {
  const log = useEnvironmentQuery(
    workflowEnvironment.tiximWorkflowLog({
      environmentId,
      input: { threadId, daemonId: run.daemonId, runId: run.runId },
    }),
  );
  const lines = log.data?.lines ?? [];
  const status = log.error
    ? "Could not read this workflow's log."
    : log.data === null
      ? "Loading log…"
      : lines.length === 0
        ? "No log output yet."
        : null;
  if (status)
    return (
      <p role="status" className="m-0 px-2.5 pb-1.5 text-2xs text-muted-foreground">
        {status}
      </p>
    );
  return (
    // Column-reverse keeps the scroll pinned to the newest line without a scroll effect.
    <div
      role="log"
      aria-label="Workflow log"
      className="mx-2.5 mb-1.5 flex max-h-40 flex-col-reverse overflow-auto rounded-md bg-muted/50 p-1.5"
    >
      <div className="font-mono text-2xs leading-4 wrap-anywhere text-foreground/85">
        {lines.map((line) => (
          <div key={line.key}>
            {line.step ? <span className="text-muted-foreground">{line.step} </span> : null}
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
