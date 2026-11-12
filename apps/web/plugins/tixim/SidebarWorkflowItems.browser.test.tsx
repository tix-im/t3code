import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId, type TiximWorkflowRun } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../test/render";
import { ThreadHoverCardPopup, Tooltip, TooltipTrigger } from "../../src/plugins/host";
import { SidebarWorkflowItems } from "./SidebarWorkflowItems";
import { WorkflowsRowAction } from "./WorkflowsRowAction";

const fixture = vi.hoisted(() => ({ runs: [] as TiximWorkflowRun[] }));
vi.mock(import("../../src/state/query"), () => ({
  useEnvironmentQuery: (() => ({
    data: { threads: [{ threadId: "thread", runs: fixture.runs, waitingOn: [] }] },
  })) as never,
}));
vi.mock(import("./FlowFrame"), () => ({
  FlowFrame: ({ environmentId }: { environmentId: EnvironmentId }) => (
    <div>Workflow environment: {environmentId}</div>
  ),
}));

it("keeps a workflow overlay open after its hover content unmounts and scopes it to the environment", async () => {
  fixture.runs = [
    {
      daemonId: "daemon",
      connectionId: "connection",
      name: "Build the sidebar workflow progress display",
      runId: "wf-calm-river-a12b",
      source: "manual",
      relationship: "waiting_on",
      state: "running",
      availability: "available",
      attention: false,
      parentRunId: "",
      submittedAt: 1,
      startedAt: null,
      finishedAt: null,
      steps: { succeeded: 2, failed: 0, skipped: 0, running: 1, waiting: 2, queued: 0 },
    },
  ];
  const registry = AtomRegistry.make();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  const environmentId = EnvironmentId.make("one");
  const threadId = ThreadId.make("thread");
  const onOpenChange = vi.fn();
  const content = (hovered: boolean) => (
    <RegistryContext value={registry}>
      {hovered ? (
        <Tooltip open>
          <TooltipTrigger render={<button type="button">Thread</button>} />
          <ThreadHoverCardPopup>
            <SidebarWorkflowItems
              environmentId={environmentId}
              threadId={threadId}
              runs={fixture.runs}
            />
          </ThreadHoverCardPopup>
        </Tooltip>
      ) : null}
      <WorkflowsRowAction
        environmentId={environmentId}
        threadId={threadId}
        onOpenChange={onOpenChange}
      />
      <WorkflowsRowAction
        environmentId={EnvironmentId.make("two")}
        threadId={threadId}
        onOpenChange={onOpenChange}
      />
    </RegistryContext>
  );
  await using screen = await render(content(true));
  await page.getByRole("button", { name: /^Open workflow/ }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(page.getByText("Workflow environment: one")).toBeVisible();
  await expect.element(page.getByText("Workflow environment: two")).not.toBeInTheDocument();
  await screen.rerender(content(false));
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
