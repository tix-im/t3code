import { EnvironmentId, ThreadId, type TiximWorkflowRun } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../test/render";

const state = vi.hoisted(() => ({ changeLink: vi.fn() }));
vi.mock(import("./state"), async (original) => {
  const module = await original();
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const run: TiximWorkflowRun = {
    daemonId: "daemon",
    connectionId: "connection",
    runId: "wf-calm-river-a12b",
    name: "Build",
    state: "running",
    parentRunId: "",
    submittedAt: null,
    startedAt: null,
    finishedAt: null,
    attention: false,
    source: "manual",
    relationship: "tracking",
    availability: "available",
  };
  const live = Atom.make(
    AsyncResult.success({
      runs: [],
      connections: [{ id: "connection", label: "Local", daemonId: "daemon", available: true }],
    }),
  );
  const search = Atom.make(AsyncResult.success({ runs: [run], connections: [] }));
  const { createWorkflowReferenceFamily } =
    await import("@t3tools/client-runtime/plugins/tixim/state");
  return {
    ...module,
    workflowEnvironment: {
      ...module.workflowEnvironment,
      reference: createWorkflowReferenceFamily({
        tiximWorkflows: (() => live) as never,
        tiximWorkflowSearch: (() => search) as never,
      }),
      tiximWorkflows: (() => live) as never,
      tiximWorkflowSearch: (() => search) as never,
      tiximWorkflowLink: { permissionAtom: () => Atom.make(true) } as never,
    },
  };
});
// Loading the real settings layout outside the app stalls the browser run before any test.
vi.mock(
  import("../../src/components/settings/settingsLayout"),
  () => ({ SettingsSection: () => null, SettingsRow: () => null }) as never,
);
vi.mock(import("../../src/plugins/host"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.changeLink) as never,
}));
import ChatMarkdown from "../../src/components/ChatMarkdown";

it("shows resolved status on hover and handles tracking failure with a retry", async () => {
  state.changeLink
    .mockReset()
    .mockResolvedValueOnce({ _tag: "Failure" })
    .mockResolvedValue({ _tag: "Success" });
  await using screen = await render(
    <ChatMarkdown
      cwd={undefined}
      text="Follow `wf-calm-river-a12b`."
      threadRef={{ environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") }}
    />,
  );
  const reference = screen.getByRole("button", { name: "wf-calm-river-a12b: running" });
  await expect.element(reference).toHaveTextContent("▶ wf-calm-river-a12b");
  await reference.hover();
  await expect.element(page.getByText("Build", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add to tracking" }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Could not add workflow to tracking.");
  await page.getByRole("button", { name: "Add to tracking" }).click();
  expect(state.changeLink).toHaveBeenLastCalledWith({
    environmentId: "env",
    input: {
      threadId: "thread",
      connectionId: "connection",
      daemonId: "daemon",
      runId: "wf-calm-river-a12b",
      attach: true,
      relationship: "tracking",
    },
  });
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});
