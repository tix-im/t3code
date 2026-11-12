export const workflowPattern = /(?<![\w-])wf-[a-z0-9]+(?:-[a-z0-9]+)+(?![\w-])/g;

export function workflowStateSymbol(state: string): string {
  switch (state.toLowerCase()) {
    case "completed":
      return "✓";
    case "failed":
      return "✕";
    case "running":
      return "▶";
    case "paused":
    case "suspended":
    case "frozen":
      return "Ⅱ";
    case "pending":
    case "queued":
      return "◷";
    case "cancelled":
    case "canceled":
    case "skipped":
      return "⊘";
    default:
      return "?";
  }
}
