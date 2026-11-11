import { EnvironmentId, type TiximWorkflowConnection } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render as renderUi } from "../../test/render";

const state = vi.hoisted(() => ({
  providers: new Map<string, ReadonlyArray<{ driver: string }>>(),
  connections: [] as TiximWorkflowConnection[],
}));
vi.mock(import("./state"), async (original) => {
  const module = await original();
  return {
    ...module,
    workflowEnvironment: {
      ...module.workflowEnvironment,
      tiximConnections: (() => ({ kind: "connections" })) as never,
    },
  };
});
vi.mock(import("../../src/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: { connections: state.connections },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  })) as never,
}));
vi.mock(import("../../src/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() => state.providers) as never,
  useEnvironments: (() => ({ presentationById: new Map() })) as never,
}));
vi.mock(import("../../src/components/sidebar/SidebarUtilityItem"), () => ({
  SidebarUtilityItem: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));
import { TiximSidebarUtility } from "./TiximConsole";

const environmentId = EnvironmentId.make("env");

it("hides the button on environments without a Tixim provider", async () => {
  state.providers = new Map([[environmentId, [{ driver: "codex" }]]]);
  await using _screen = await renderUi(<TiximSidebarUtility />);
  await expect.element(page.getByRole("button", { name: "Tixim" })).not.toBeInTheDocument();
});

it("opens the run list on the first reachable connection and switches pages", async () => {
  state.providers = new Map([[environmentId, [{ driver: "tixim" }]]]);
  state.connections = [
    { id: "down", label: "Down", daemonId: "", available: false },
    { id: "up", label: "Up", daemonId: "daemon", available: true },
  ];
  await using screen = await renderUi(<TiximSidebarUtility />);
  await screen.getByRole("button", { name: "Tixim" }).click();
  const frame = page.getByTitle("Tix Flow: Up");
  await expect.element(frame).toHaveAttribute("src", "/tix-flow/index.html#/runs");
  await page.getByRole("button", { name: "Workflows" }).click();
  await expect.element(frame).toHaveAttribute("src", "/tix-flow/index.html#/workflows");
  await page.getByRole("button", { name: "Input" }).click();
  await expect.element(frame).toHaveAttribute("src", "/tix-flow/index.html#/pending");
});

it("explains when no connection is reachable", async () => {
  state.providers = new Map([[environmentId, [{ driver: "tixim" }]]]);
  state.connections = [{ id: "down", label: "Down", daemonId: "", available: false }];
  await using screen = await renderUi(<TiximSidebarUtility />);
  await screen.getByRole("button", { name: "Tixim" }).click();
  await expect
    .element(page.getByText("No Tixim connection is reachable on this environment."))
    .toBeVisible();
});
