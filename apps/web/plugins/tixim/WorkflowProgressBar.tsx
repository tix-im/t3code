import { cn } from "../../src/plugins/host";
import type { workflowStepProgress } from "./workflowPresentation";

export function WorkflowProgressBar({
  done,
  total,
  failed,
}: NonNullable<ReturnType<typeof workflowStepProgress>>) {
  return (
    <span
      role="progressbar"
      aria-label="Workflow steps"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="block h-1 overflow-hidden rounded-full bg-muted"
    >
      <span
        className={cn("block h-full", failed ? "bg-destructive" : "bg-info")}
        style={{ width: `${(done / total) * 100}%` }}
      />
    </span>
  );
}
