import {
  EnvironmentId,
  ThreadId,
  type TiximWorkflowRun,
  type TiximWorkflowConnection,
  type TiximWorkflowSearchInput,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";
import { render as renderUi } from "../../test/render";

type Query =
  | { kind: "list" }
  | { kind: "search"; input: TiximWorkflowSearchInput }
  | { kind: "log" };
const state = vi.hoisted(() => ({
  runs: [] as TiximWorkflowRun[],
  candidates: [] as TiximWorkflowRun[],
  connections: [] as TiximWorkflowConnection[],
  queries: [] as TiximWorkflowSearchInput[],
  pendingQuery: null as string | null,
  snoozed: false,
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
      tiximWorkflowLog: (() => ({ kind: "log" })) as never,
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
    if (query?.kind === "log")
      return {
        data: { lines: [{ key: "1:0", text: "compiling crate" }], finished: false },
        error: null,
        isPending: true,
        refresh: state.refresh,
      };
    return {
      data: {
        runs: query?.kind === "search" ? state.candidates : state.runs,
        connections: state.connections,
        snoozed: state.snoozed,
      },
      dataUpdatedAt: 0,
      error: null,
      // A stream atom reports waiting on every emission until the stream ends.
      isPending: query?.kind === "list" || query?.input.query === state.pendingQuery,
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
  expect(state.queries).toContainEqual({
    threadId: "thread",
    connectionId: "connection",
    query: "",
    mentionedOnly: true,
  });
  expect(state.changeLink).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Copy workflow ID" }).first().click();
  expect(state.changeLink).not.toHaveBeenCalled();
  await expect.element(page.getByRole("button", { name: "Attach as Untracked" })).toBeVisible();
  await page.getByRole("button", { name: /^Attach as/ }).click();
  await page.getByRole("menuitemradio", { name: "Waiting on" }).click();
  await page.getByRole("option", { name: /^Other daemon/ }).click();
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
    .element(page.getByRole("combobox", { name: "Search workflow runs" }))
    .not.toBeInTheDocument();
  expect(state.refresh).toHaveBeenCalledOnce();
  await screen.getByRole("button", { name: "Attach workflow", exact: true }).click();
  state.candidates = [];
  await page.getByRole("combobox", { name: "Search workflow runs" }).fill("river");
  await expect
    .poll(() => state.queries.at(-1))
    .toMatchObject({ query: "river", mentionedOnly: false });

  state.candidates = [run("two", "Late match")];
  state.pendingQuery = "river";
  await screen.rerender(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await expect.element(page.getByRole("option", { name: /^Late match/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(state.changeLink).toHaveBeenCalledOnce();

  state.pendingQuery = null;
  await screen.rerender(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => state.changeLink.mock.calls.length).toBe(2);
});

it("shows a snooze at once without restarting the workflow stream", async () => {
  state.connections = [{ id: "connection", label: "Local", daemonId: "one", available: true }];
  state.runs = [run("one", "Build")];
  state.snoozed = false;
  state.refresh.mockReset();
  state.changeLink.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { status: "snoozed", runCount: 1 },
  });
  await using screen = await renderUi(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  await screen.getByRole("button", { name: "Snooze until workflows finish" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Wake thread now" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(state.changeLink).toHaveBeenCalledWith({
    environmentId: "env",
    input: { threadId: "thread", snoozing: true },
  });
  expect(state.refresh).not.toHaveBeenCalled();
});

it("shows step progress for multi-step runs and toggles a run's live log", async () => {
  const steps = { running: 1, failed: 0, waiting: 2, queued: 1, succeeded: 1, skipped: 0 };
  state.connections = [{ id: "connection", label: "Local", daemonId: "one", available: true }];
  state.runs = [
    { ...run("one", "Build"), steps },
    {
      ...run("one", "Session"),
      runId: "wf-solo",
      steps: { ...steps, running: 1, waiting: 0, queued: 0, succeeded: 0 },
    },
  ];
  await using screen = await renderUi(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  const bar = screen.getByRole("progressbar");
  await expect.element(bar).toHaveAttribute("aria-valuenow", "1");
  await expect.element(bar).toHaveAttribute("aria-valuemax", "4");
  // The row menu only takes pointer events while the row is hovered or focused.
  const openMenu = async () => {
    (screen.getByRole("button", { name: "Manage Build" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
  };
  await openMenu();
  await page.getByRole("menuitem", { name: "Show log" }).click();
  await expect.element(page.getByRole("log")).toHaveTextContent("compiling crate");
  await openMenu();
  await page.getByRole("menuitem", { name: "Hide log" }).click();
  await expect.element(page.getByRole("log")).not.toBeInTheDocument();
});

it("keeps the row menu usable under the hover card and opens the run from its link", async () => {
  state.connections = [{ id: "connection", label: "Local", daemonId: "one", available: true }];
  state.runs = [run("one", "Hovered run")];
  state.changeLink.mockReset();
  await using screen = await renderUi(
    <ThreadWorkflowsControl
      environmentId={EnvironmentId.make("env")}
      threadId={ThreadId.make("thread")}
      isServerThread
      displayMode="panel"
    />,
  );
  const row = screen.getByRole("button", { name: /^Hovered run/ });
  const link = page.getByRole("button", { name: "Open workflow", exact: true });
  await userEvent.hover(row);
  await expect.element(link).toBeVisible();
  await screen.getByRole("button", { name: "Manage Hovered run", exact: true }).click();
  await expect.element(page.getByRole("menuitem", { name: "Detach" })).toBeVisible();
  await userEvent.keyboard("{Escape}");

  await userEvent.hover(row);
  await link.click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(link).not.toBeInTheDocument();
});

it("searches a connection still being checked and retries one that is unavailable", async () => {
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
  await expect.element(page.getByText("No recent runs on Local.")).toBeVisible();
  expect(state.queries).toContainEqual({
    threadId: "thread",
    connectionId: "connection",
    query: "",
    mentionedOnly: false,
  });
  await page.getByRole("button", { name: "Tixim connection", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /Local/ }).click();

  state.connections = [{ id: "connection", label: "Local", daemonId: "", available: false }];
  state.queries = [];
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
  await expect.poll(() => state.queries.at(-1)).toMatchObject({ connectionId: "connection" });
});
