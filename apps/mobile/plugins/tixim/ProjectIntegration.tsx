import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import {
  AppText as Text,
  Button,
  useAtomCommand,
  useEnvironmentQuery,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";

function useConnection(environmentId: EnvironmentId, projectIds: readonly string[] | null) {
  const [connectionId, setConnectionId] = useState("");
  const connections = useEnvironmentQuery(
    workflowEnvironment.tiximConnections({ environmentId, input: {} }),
  );
  const available = connections.data?.connections.filter((item) => item.available) ?? [];
  const selected = available.find((item) => item.id === connectionId);
  const projects = useEnvironmentQuery(
    selected
      ? workflowEnvironment.tiximProjects({
          environmentId,
          input: {
            connectionId: selected.id,
            ...(projectIds ? { projectIds: [...projectIds] } : {}),
          },
        })
      : null,
  );
  const links = useEnvironmentQuery(
    workflowEnvironment.tiximProjectLinks({ environmentId, input: {} }),
  );
  return { selected, available, setConnectionId, projects, links };
}

function commandError(result: { readonly cause: Cause.Cause<unknown> }): string {
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : String(error);
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className="rounded-xl border border-border-subtle bg-grouped-card px-4 py-3"
    >
      <Text className="text-base text-foreground">
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

function ProjectDialog({
  environmentId,
  projectIds,
  onClose,
}: {
  environmentId: EnvironmentId;
  projectIds: readonly string[] | null;
  onClose: () => void;
}) {
  const state = useConnection(environmentId, projectIds);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = useAtomCommand(workflowEnvironment.tiximProjectLink, { reportFailure: false });
  const importProject = useAtomCommand(workflowEnvironment.tiximProjectImport, {
    reportFailure: false,
  });
  const unlink = useAtomCommand(workflowEnvironment.tiximProjectUnlink, { reportFailure: false });
  const sync = useAtomCommand(workflowEnvironment.tiximProjectSync, { reportFailure: false });
  const linked = state.links.data?.links.find((row) => projectIds?.includes(row.projectId));
  const selectedTarget = target ?? state.projects.data?.suggestedProjectId ?? "";
  const mutate = async (mode: "link" | "create" | "import" | "unlink" | "sync") => {
    if (busy || ((mode === "link" || mode === "create" || mode === "import") && !state.selected))
      return;
    setBusy(true);
    setError(null);
    const connectionId = state.selected?.id ?? linked?.connectionId ?? "";
    let failureMessage: string | null = null;
    if (mode === "link" || mode === "create") {
      const result = await link({
        environmentId,
        input: {
          connectionId,
          projectIds: [...(projectIds ?? [])],
          ...(mode === "create" ? { create: true } : { tiximProjectId: selectedTarget }),
        },
      });
      if (result._tag === "Failure") failureMessage = commandError(result);
    } else if (mode === "import") {
      const result = await importProject({
        environmentId,
        input: { connectionId, tiximProjectId: selectedTarget },
      });
      if (result._tag === "Failure") failureMessage = commandError(result);
    } else if (mode === "sync") {
      const result = await sync({
        environmentId,
        input: { connectionId: linked?.connectionId ?? connectionId },
      });
      if (result._tag === "Failure") failureMessage = commandError(result);
    } else {
      const ids = (projectIds ?? []).filter((id) =>
        state.links.data?.links.some((row) => row.projectId === id),
      );
      const results = await Promise.all(
        ids.map((projectId) => unlink({ environmentId, input: { projectId } })),
      );
      const failed = results.find((result) => result._tag === "Failure");
      if (failed?._tag === "Failure") failureMessage = commandError(failed);
    }
    setBusy(false);
    if (failureMessage) setError(failureMessage);
    else {
      state.projects.refresh();
      state.links.refresh();
      onClose();
    }
  };
  return (
    <ScrollView contentContainerClassName="gap-4 p-6 pt-12">
      <Text className="text-xl font-t3-semibold text-foreground">Tixim project</Text>
      <Button label="Close" onPress={onClose} />
      {linked ? (
        <Text className="text-base text-foreground">Linked to {linked.tiximProjectName}</Text>
      ) : null}
      {linked?.lastError ? (
        <Text className="text-sm text-danger-foreground">{linked.lastError}</Text>
      ) : null}
      <Text className="text-sm font-t3-medium text-foreground-muted">Connection</Text>
      {state.available.map((item) => (
        <Choice
          key={item.id}
          label={item.label}
          selected={item.id === state.selected?.id}
          onPress={() => {
            state.setConnectionId(item.id);
            setTarget(null);
          }}
        />
      ))}
      {!linked ? (
        <>
          <Text className="text-sm font-t3-medium text-foreground-muted">Tixim project</Text>
          {state.projects.data?.projects.map((project) => (
            <Choice
              key={project.project_id}
              label={project.name}
              selected={project.project_id === selectedTarget}
              onPress={() => setTarget(project.project_id)}
            />
          ))}
          <Button
            label={projectIds ? "Link project" : "Import project"}
            disabled={busy || !selectedTarget || !state.selected}
            onPress={() => void mutate(projectIds ? "link" : "import")}
          />
          {projectIds ? (
            <Button
              label="Create in Tixim"
              disabled={busy || !state.selected}
              onPress={() => void mutate("create")}
            />
          ) : null}
        </>
      ) : (
        <>
          <Button label="Sync now" disabled={busy} onPress={() => void mutate("sync")} />
          <Button label="Unlink" disabled={busy} onPress={() => void mutate("unlink")} />
        </>
      )}
      {error || state.projects.error ? (
        <Text className="text-sm text-danger-foreground">{error ?? state.projects.error}</Text>
      ) : null}
    </ScrollView>
  );
}

function Entry({
  environmentId,
  projectIds,
  label,
}: {
  environmentId: EnvironmentId;
  projectIds: readonly string[] | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2 p-4">
      <Button label={label} onPress={() => setOpen(true)} />
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <ProjectDialog
          environmentId={environmentId}
          projectIds={projectIds}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </View>
  );
}

export function ProjectSettings(props: {
  environmentId: EnvironmentId;
  projectIds: readonly string[];
}) {
  return <Entry {...props} label="Tixim project" />;
}
export function ProjectImport(props: { environmentId: EnvironmentId }) {
  return <Entry {...props} projectIds={null} label="Import from Tixim" />;
}
