import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";

const fixture = vi.hoisted(() => ({
  connections: [{ id: "connection", label: "Local Tixim", available: true }],
  links: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ command: string; request: unknown }>,
}));

vi.mock("../../src/plugins/host", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  SettingsSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SettingsRow: ({
    title,
    description,
    control,
  }: {
    title: string;
    description?: string;
    control: React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {control}
    </div>
  ),
  useEnvironmentQuery: (query: string | null) => ({
    data:
      query === "connections"
        ? { connections: fixture.connections }
        : query === "projects"
          ? { projects: [{ project_id: "tix-project", name: "Example" }] }
          : query === "links"
            ? { links: fixture.links }
            : null,
    error: null,
    refresh: vi.fn(),
  }),
  useAtomCommand: (command: string) => async (request: unknown) => {
    fixture.calls.push({ command, request });
    return { _tag: "Success", value: {} };
  },
}));
vi.mock("./state", () => ({
  workflowEnvironment: {
    tiximConnections: () => "connections",
    tiximProjects: () => "projects",
    tiximProjectLinks: () => "links",
    tiximProjectLink: "link",
    tiximProjectImport: "import",
    tiximProjectUnlink: "unlink",
    tiximProjectSync: "sync",
  },
}));

import { ProjectImport, ProjectSettings } from "./ProjectIntegration";

const environmentId = EnvironmentId.make("local");

async function choose(label: string, value: string) {
  const element = page.getByRole("combobox", { name: label }).element() as HTMLSelectElement;
  await act(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("requires a connection and exposes link, create and import controls", async () => {
  fixture.calls = [];
  fixture.links = [];
  await using screen = await render(
    <ProjectSettings environmentId={environmentId} projectIds={["checkout-a", "checkout-b"]} />,
    { router: false },
  );
  expect(
    (screen.getByRole("button", { name: "Create in Tixim" }).element() as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await choose("Tixim connection", "connection");
  await choose("Existing Tixim project", "tix-project");
  await userEvent.click(page.getByRole("button", { name: "Link", exact: true }));
  expect(fixture.calls[0]).toEqual({
    command: "link",
    request: {
      environmentId,
      input: {
        connectionId: "connection",
        projectIds: ["checkout-a", "checkout-b"],
        tiximProjectId: "tix-project",
      },
    },
  });
  await userEvent.click(page.getByRole("button", { name: "Create in Tixim" }));
  expect(fixture.calls[1]).toEqual({
    command: "link",
    request: {
      environmentId,
      input: { connectionId: "connection", projectIds: ["checkout-a", "checkout-b"], create: true },
    },
  });
  await screen.unmount();

  await using _importScreen = await render(<ProjectImport environmentId={environmentId} />, {
    router: false,
  });
  await choose("Tixim connection", "connection");
  await choose("Tixim project to import", "tix-project");
  await userEvent.click(page.getByRole("button", { name: "Import" }));
  expect(fixture.calls[2]).toEqual({
    command: "import",
    request: {
      environmentId,
      input: { connectionId: "connection", tiximProjectId: "tix-project" },
    },
  });
});

it("shows sync errors and permits unlink while Tixim is unavailable", async () => {
  fixture.calls = [];
  fixture.connections = [];
  fixture.links = [
    {
      projectId: "checkout-a",
      connectionId: "connection",
      daemonUrl: "http://daemon",
      tiximProjectId: "tix-project",
      tiximProjectName: "Example",
      primaryPath: "/work/primary",
      lastError: "Tixim daemon is disconnected",
    },
  ];
  await using _screen = await render(
    <ProjectSettings environmentId={environmentId} projectIds={["checkout-a"]} />,
    { router: false },
  );
  await expect.element(page.getByRole("alert")).toHaveTextContent("Tixim daemon is disconnected");
  await userEvent.click(page.getByRole("button", { name: "Unlink" }));
  expect(fixture.calls).toEqual([
    { command: "unlink", request: { environmentId, input: { projectId: "checkout-a" } } },
  ]);
  fixture.connections = [{ id: "connection", label: "Local Tixim", available: true }];
});
