import { workflowStateSymbol } from "@t3tools/client-runtime/plugins/tixim/references";
import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { TiximWorkflowRun } from "@t3tools/contracts";
import type { PluginThreadProps } from "../../src/plugins/api";
import {
  AppText,
  AppTextInput,
  Button,
  useAtomCommand,
  useEnvironmentQuery,
} from "../../src/plugins/host";
import { workflowEnvironment } from "./state";

export function ThreadWorkflows({
  environmentId,
  threadId,
  referenceHid,
  onDismiss,
}: PluginThreadProps & { referenceHid?: string; onDismiss?: () => void }) {
  const [open, setOpen] = useState(referenceHid !== undefined);
  const [query, setQuery] = useState(referenceHid ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useEnvironmentQuery(
    workflowEnvironment.tiximWorkflows({ environmentId, input: { threadId } }),
  );
  const reference = useAtomValue(
    workflowEnvironment.reference(environmentId)(threadId)(query.trim()),
  );
  const permission = useAtomValue(
    workflowEnvironment.tiximWorkflowLink.permissionAtom(environmentId),
  );
  const changeLink = useAtomCommand(workflowEnvironment.tiximWorkflowLink, {
    reportFailure: false,
  });
  const runs = query.trim() ? reference.runs : (live.data?.runs ?? []);
  const change = async (run: TiximWorkflowRun, attach: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await changeLink({
        environmentId,
        input: {
          threadId,
          connectionId: run.connectionId,
          daemonId: run.daemonId,
          runId: run.runId,
          attach,
          relationship: "tracking",
        },
      });
      if (result._tag === "Failure") setError("Could not update workflow tracking.");
      else live.refresh();
    } catch {
      setError("Could not update workflow tracking.");
    }
    setBusy(false);
  };
  return (
    <>
      {referenceHid === undefined ? (
        <Button
          label={`Workflows (${live.data?.runs.length ?? 0})`}
          tone="text"
          onPress={() => setOpen(true)}
        />
      ) : null}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setOpen(false);
          onDismiss?.();
        }}
      >
        <ScrollView contentContainerClassName="gap-4 p-6 pt-12">
          <AppText accessibilityRole="header">Workflows</AppText>
          <Button
            label="Close"
            onPress={() => {
              setOpen(false);
              onDismiss?.();
            }}
          />
          <AppTextInput
            accessibilityLabel="Workflow HID"
            placeholder="wf-…"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {live.error ? <AppText>{live.error}</AppText> : null}
          {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
          {runs.length === 0 ? (
            <AppText>
              {live.isPending || reference.loading
                ? "Loading workflows…"
                : reference.unavailable
                  ? "Workflow information is unavailable."
                  : "No workflows found."}
            </AppText>
          ) : null}
          {runs.map((run) => {
            const linked = live.data?.runs.find(
              (item) => item.daemonId === run.daemonId && item.runId === run.runId,
            );
            const tracked = linked?.relationship === "tracking";
            return (
              <View key={`${run.daemonId}:${run.runId}`} className="gap-2">
                <AppText>
                  {workflowStateSymbol(
                    run.availability === "available" ? run.state : "Unavailable",
                  )}{" "}
                  {run.runId}
                </AppText>
                <AppText>
                  {run.availability === "available" ? run.state : "Unavailable"} · {run.daemonId}
                </AppText>
                <Button
                  label={
                    tracked
                      ? "Remove tracking"
                      : linked
                        ? `Attached · ${linked.relationship.replaceAll("_", " ")}`
                        : "Add to tracking"
                  }
                  disabled={
                    !permission ||
                    busy ||
                    (linked !== undefined && !tracked) ||
                    (!tracked && run.availability !== "available")
                  }
                  onPress={() => {
                    void change(run, !tracked);
                  }}
                />
              </View>
            );
          })}
        </ScrollView>
      </Modal>
    </>
  );
}
