import { cn } from "../../src/plugins/host";
import type { OrderedWorkflowRun } from "./workflowPresentation";

/** Indent per tree level; rows add their own 11px before the 16px state icon. */
export const WORKFLOW_TREE_INDENT = 22;
const ICON_CENTER_X = 19;
const line = "pointer-events-none absolute w-px bg-muted-foreground/35";

/** Connector lines from each run's state icon to its children's. */
export function WorkflowTreeGuides({
  entry,
  iconCenterY,
}: {
  entry: Pick<OrderedWorkflowRun, "depth" | "rails" | "last" | "hasChildren">;
  /** Vertical center of the 16px state icon within the row. */
  iconCenterY: number;
}) {
  const { depth, rails, last, hasChildren } = entry;
  const column = (level: number) => level * WORKFLOW_TREE_INDENT + ICON_CENTER_X - 0.5;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {rails
        .flatMap((continues, level) => (continues ? [column(level)] : []))
        .map((left) => (
          <span key={left} className={cn(line, "inset-y-0")} style={{ left }} />
        ))}
      {depth > 0 ? (
        <>
          <span
            className="pointer-events-none absolute top-0 rounded-bl-md border-b border-l border-muted-foreground/35"
            style={{
              left: column(depth - 1),
              height: iconCenterY + 0.5,
              width: WORKFLOW_TREE_INDENT - 10,
            }}
          />
          {last ? null : (
            <span className={cn(line, "inset-y-0")} style={{ left: column(depth - 1) }} />
          )}
        </>
      ) : null}
      {hasChildren ? (
        <span
          className={cn(line, "bottom-0")}
          style={{ left: column(depth), top: iconCenterY + 10 }}
        />
      ) : null}
    </span>
  );
}
