import { cn } from "../../src/plugins/host";
import { WORKFLOW_TONE_CLASS, type WorkflowCount } from "./workflowPresentation";

export function WorkflowTally({
  counts,
  noun,
  labelled = false,
}: {
  counts: ReadonlyArray<WorkflowCount>;
  /** Names what is counted for screen readers, where the visible context does not. */
  noun?: string;
  labelled?: boolean;
}) {
  if (counts.length === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        labelled && "flex-wrap gap-x-2 gap-y-0.5",
      )}
    >
      {counts.map(({ key, count, label, icon: Icon, tone }) => (
        <span
          key={key}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 tabular-nums",
            WORKFLOW_TONE_CLASS[tone],
          )}
        >
          <Icon aria-hidden className="size-3" />
          <span aria-hidden>{count}</span>
          {labelled ? (
            <span aria-hidden className="text-muted-foreground">
              {label}
            </span>
          ) : null}
          <span className="sr-only">
            {count} {label}
            {noun ? ` ${noun}` : ""}
          </span>
        </span>
      ))}
    </span>
  );
}
