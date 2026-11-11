import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";
import {
  Button,
  SettingsRow,
  SettingsSection,
  useAtomCommand,
  useEnvironmentQuery,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";

function useProjectConnection(environmentId: EnvironmentId) {
  const [choice, setChoice] = useState("");
  const connections = useEnvironmentQuery(
    workflowEnvironment.tiximConnections({ environmentId, input: {} }),
  );
  const available = connections.data?.connections.filter((item) => item.available) ?? [];
  const selected = available.find((item) => item.id === choice);
  const projects = useEnvironmentQuery(
    selected
      ? workflowEnvironment.tiximProjects({ environmentId, input: { connectionId: selected.id } })
      : null,
  );
  const links = useEnvironmentQuery(
    workflowEnvironment.tiximProjectLinks({ environmentId, input: {} }),
  );
  return { choice, setChoice, selected, available, projects, links, connections };
}

function ConnectionSelect({
  available,
  value,
  onChange,
}: {
  available: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label="Tixim connection"
      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="">Choose a connection</option>
      {available.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

function commandError(result: { readonly cause: Cause.Cause<unknown> }): string {
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : String(error);
}

export function ProjectSettings({
  environmentId,
  projectIds,
}: {
  environmentId: EnvironmentId;
  projectIds: readonly string[];
}) {
  const state = useProjectConnection(environmentId);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = useAtomCommand(workflowEnvironment.tiximProjectLink, { reportFailure: false });
  const unlink = useAtomCommand(workflowEnvironment.tiximProjectUnlink, { reportFailure: false });
  const sync = useAtomCommand(workflowEnvironment.tiximProjectSync, { reportFailure: false });
  const linked = state.links.data?.links.find((item) => projectIds.includes(item.projectId));
  const available = state.available;
  const connectionId = state.selected?.id ?? "";
  const run = async (create: boolean) => {
    if (!connectionId || busy) return;
    setBusy(true);
    setError(null);
    const result = await link({
      environmentId,
      input: {
        connectionId,
        projectIds: [...projectIds],
        ...(create ? { create: true } : { tiximProjectId: target }),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") setError(commandError(result));
    else {
      state.projects.refresh();
      state.links.refresh();
    }
  };
  const remove = async () => {
    if (!linked || busy) return;
    setBusy(true);
    setError(null);
    const results = await Promise.all(
      projectIds
        .filter((id) => state.links.data?.links.some((item) => item.projectId === id))
        .map((projectId) => unlink({ environmentId, input: { projectId } })),
    );
    setBusy(false);
    const failed = results.find((result) => result._tag === "Failure");
    if (failed?._tag === "Failure") setError(commandError(failed));
    state.links.refresh();
  };
  const retry = async () => {
    if (!linked || busy) return;
    setBusy(true);
    setError(null);
    const result = await sync({ environmentId, input: { connectionId: linked.connectionId } });
    setBusy(false);
    if (result._tag === "Failure") setError(commandError(result));
    state.projects.refresh();
    state.links.refresh();
  };
  return (
    <SettingsSection title="Tixim project">
      <SettingsRow
        title="Connection"
        description="Choose the Tixim daemon that owns this project."
        control={
          available.length ? (
            <ConnectionSelect
              available={available}
              value={connectionId}
              onChange={(id) => {
                state.setChoice(id);
                setTarget("");
              }}
            />
          ) : (
            <span className="text-sm text-muted-foreground">No Tixim connection is available.</span>
          )
        }
      />
      {linked ? (
        <SettingsRow
          title="Linked project"
          description={`${linked.tiximProjectName} · ${linked.tiximProjectId}`}
          control={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry()}>
                Sync now
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>
                Unlink
              </Button>
            </div>
          }
        />
      ) : (
        <SettingsRow
          title="Link or create"
          description="Link this project’s checkouts to Tixim."
          control={
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Existing Tixim project"
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                value={target}
                onChange={(event) => setTarget(event.currentTarget.value)}
              >
                <option value="">Choose a Tixim project</option>
                {state.projects.data?.projects.map((project) => (
                  <option key={project.project_id} value={project.project_id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !target}
                onClick={() => void run(false)}
              >
                Link
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !connectionId}
                onClick={() => void run(true)}
              >
                Create in Tixim
              </Button>
            </div>
          }
        />
      )}
      {error || state.projects.error || linked?.lastError ? (
        <p role="alert" className="px-3 text-sm text-destructive-foreground">
          {error ?? state.projects.error ?? linked?.lastError}
        </p>
      ) : null}
    </SettingsSection>
  );
}

export function ProjectImport({ environmentId }: { environmentId: EnvironmentId }) {
  const state = useProjectConnection(environmentId);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importProject = useAtomCommand(workflowEnvironment.tiximProjectImport, {
    reportFailure: false,
  });
  const run = async () => {
    if (!state.selected || !target || busy) return;
    setBusy(true);
    setError(null);
    const result = await importProject({
      environmentId,
      input: {
        connectionId: state.selected.id,
        tiximProjectId: target,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") setError(commandError(result));
    else {
      state.projects.refresh();
      state.links.refresh();
    }
  };
  if (state.available.length === 0) return null;
  return (
    <div className="p-4">
      <SettingsSection title="Import from Tixim">
        <SettingsRow
          title="Connection"
          control={
            <ConnectionSelect
              available={state.available}
              value={state.selected?.id ?? ""}
              onChange={(id) => {
                state.setChoice(id);
                setTarget("");
              }}
            />
          }
        />
        <SettingsRow
          title="Project"
          control={
            <div className="flex items-center gap-2">
              <select
                aria-label="Tixim project to import"
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                value={target}
                onChange={(event) => setTarget(event.currentTarget.value)}
              >
                <option value="">Choose a project</option>
                {state.projects.data?.projects.map((project) => (
                  <option key={project.project_id} value={project.project_id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={busy || !target} onClick={() => void run()}>
                Import
              </Button>
            </div>
          }
        />
        {error || state.projects.error ? (
          <p role="alert" className="px-3 text-sm text-destructive-foreground">
            {error ?? state.projects.error}
          </p>
        ) : null}
      </SettingsSection>
    </div>
  );
}
