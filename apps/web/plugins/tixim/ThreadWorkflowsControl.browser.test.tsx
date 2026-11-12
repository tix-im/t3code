import {
  EnvironmentId,
  ThreadId,
  type TiximWorkflowRun,
  type TiximWorkflowConnection,
  type TiximWorkflowSearchInput,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render as renderUi } from "../../test/render";

type Query = { kind: "list" } | { kind: "search"; input: TiximWorkflowSearchInput };
const state = vi.hoisted(() => ({
  runs: [] as TiximWorkflowRun[],
  candidates: [] as TiximWorkflowRun[],
  connections: [] as TiximWorkflowConnection[],
  queries: [] as TiximWorkflowSearchInput[],
  changeLink: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock(import("./state"), async (original) => {
  const module = await original();
  return {
    ...module,
    workflowEnvironment: {
      ...module.workflowEnvironment,
      tiximWorkflows: (() => ({ kind: "list" })) as never,
      tiximWorkflowSearch: (({ input }: { input: TiximWorkflowSearchInput }) => ({
        kind: "search",
        input,
      })) as never,
    },
  };
});
vi.mock(import("../../src/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: Query | null) => {
    if (query?.kind === "search") state.queries.push(query.input);
    return {
      data: {
        runs: query?.kind === "search" ? state.candidates : state.runs,
        connections: state.connections,
      },
      error: null,
      isPending: false,
      refresh: state.refresh,
    };
  }) as never,
}));
vi.mock(import("../../src/plugins/host"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.changeLink) as never,
}));
import { ThreadWorkflowsControl } from "./ThreadWorkflowsControl";

const run = (daemonId: string, name: string): TiximWorkflowRun => ({
  daemonId,
  name,
  runId: "wf-calm-river-a12b",
  connectionId: "connection",
  source: "manual",
  relationship: "tracking",
  state: "running",
  availability: "available",
  attention: false,
  parentRunId: "",
  submittedAt: 1,
  startedAt: null,
  finishedAt: null,
});

it("attaches a suggested dependency from the selected daemon and searches without treating mentions as links", async () => {
  state.connections = [{ id: "connection", label: "Local", daemonId: "two", available: true }];
  state.runs = [run("one", "Already attached")];
  state.candidates = [run("one", "Already attached"), run("two", "Other daemon")];
  state.queries = [];
  state.refresh.mockReset();
  state.changeLink.mockReset().mockResolvedValue({ _tag: "Success" });
  await using screen = await renderUi(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await screen.getByRole("button", { name: "Attach workflow", exact: true }).click();
  await expect.element(page.getByText("Mentioned in this chat", { exact: true })).toBeVisible();
  expect(state.queries.at(-1)).toMatchObject({
    threadId: "thread",
    connectionId: "connection",
    mentionedOnly: true,
  });
  expect(state.changeLink).not.toHaveBeenCalled();
  await page
    .getByRole("combobox", { name: "Relationship", exact: true })
    .selectOptions("waiting_on");
  await page.getByRole("button", { name: /^Other daemon/ }).click();
  expect(state.changeLink).toHaveBeenCalledWith({
    environmentId: "env",
    input: {
      threadId: "thread",
      connectionId: "connection",
      daemonId: "two",
      runId: "wf-calm-river-a12b",
      attach: true,
      relationship: "waiting_on",
    },
  });
  await expect
    .element(page.getByRole("textbox", { name: "Search workflow runs" }))
    .not.toBeInTheDocument();
  expect(state.refresh).toHaveBeenCalledOnce();
  await screen.getByRole("button", { name: "Attach workflow", exact: true }).click();
  await page.getByRole("textbox", { name: "Search workflow runs" }).fill("river");
  await expect
    .poll(() => state.queries.at(-1))
    .toMatchObject({ query: "river", mentionedOnly: false });
});

it("keeps a loading connection selectable and retries an unavailable connection before searching", async () => {
  state.runs = [];
  state.candidates = [];
  state.connections = [
    { id: "connection", label: "Local", daemonId: "", available: false, loading: true },
  ];
  state.queries = [];
  state.refresh.mockReset();
  state.changeLink.mockReset();
  await using screen = await renderUi(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await screen.getByRole("button", { name: "Attach workflow", exact: true }).click();
  await expect.element(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "Tixim connection", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /Local/ }).click();
  expect(state.queries).toHaveLength(0);

  state.connections = [{ id: "connection", label: "Local", daemonId: "", available: false }];
  await screen.rerender(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.queries).toHaveLength(0);

  state.connections = [{ id: "connection", label: "Local", daemonId: "two", available: true }];
  await screen.rerender(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await expect.element(page.getByText("Mentioned in this chat", { exact: true })).toBeVisible();
  expect(state.queries.at(-1)).toMatchObject({ connectionId: "connection", mentionedOnly: true });
});
