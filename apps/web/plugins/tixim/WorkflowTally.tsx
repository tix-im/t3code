import { cn } from "../../src/plugins/host";
import { WORKFLOW_TONE_CLASS, type WorkflowCount } from "./workflowPresentation";

export function WorkflowTally({ counts }: { counts: ReadonlyArray<WorkflowCount> }) {
  if (counts.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
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
          <span className="sr-only">
            {count} {label}
          </span>
        </span>
      ))}
    </span>
  );
}
