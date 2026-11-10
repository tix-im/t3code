import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ThreadId,
  TiximWorkflowListResult,
  TiximWorkflowRun,
  TiximWorkflowSearchInput,
} from "@t3tools/contracts";
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { AsyncResult, Atom } from "effect/reactivity";

export function createWorkflowEnvironment<R, E>(
  connectionAtomRuntime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const workflowEnvironment = {
    listTiximContexts: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
      label: "environment-data:server:tixim:contexts",
      tag: WS_METHODS.serverListTiximContexts,
      staleTimeMs: 30_000,
    }),
    listTiximModels: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
      label: "environment-data:server:tixim:models",
      tag: WS_METHODS.serverListTiximModels,
      staleTimeMs: 30_000,
    }),
    listTiximHarnesses: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
      label: "environment-data:server:tixim:harnesses",
      tag: WS_METHODS.serverListTiximHarnesses,
      staleTimeMs: 30_000,
    }),

    tiximWorkflows: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
      label: "tixim:tiximWorkflows",
      tag: WS_METHODS.tiximWorkflows,
    }),
    tiximWorkflowSearch: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
      label: "tixim:tiximWorkflowSearch",
      tag: WS_METHODS.tiximWorkflowSearch,
    }),
    tiximWorkflowLink: createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "tixim:tiximWorkflowLink",
      tag: WS_METHODS.tiximWorkflowLink,
    }),
  };

  return { ...workflowEnvironment, reference: createWorkflowReferenceFamily(workflowEnvironment) };
}

export function createWorkflowReferenceFamily(workflowEnvironment: {
  tiximWorkflows: (request: {
    environmentId: EnvironmentId;
    input: { threadId: ThreadId };
  }) => Atom.Atom<AsyncResult.AsyncResult<typeof TiximWorkflowListResult.Type, unknown>>;
  tiximWorkflowSearch: (request: {
    environmentId: EnvironmentId;
    input: TiximWorkflowSearchInput;
  }) => Atom.Atom<AsyncResult.AsyncResult<typeof TiximWorkflowListResult.Type, unknown>>;
}) {
  const reference = Atom.family((environmentId: EnvironmentId) =>
    Atom.family((threadId: ThreadId) =>
      Atom.family((hid: string) =>
        Atom.make((get) => {
          const liveAtom = workflowEnvironment.tiximWorkflows({
            environmentId,
            input: { threadId },
          });
          const live = get(liveAtom);
          const data = AsyncResult.getOrElse(live, () => null);
          const named = (run: TiximWorkflowRun) => run.runId === hid || run.hid === hid;
          const linked = data?.runs.filter(named) ?? [];
          const runs = [...linked];
          // A subscription reports waiting on every emission, so only missing data means loading.
          let loading = data === null && (live.waiting || live._tag === "Initial");
          let unavailable = live._tag === "Failure";
          const queries = (hid.trim() ? (data?.connections ?? []) : [])
            .filter((connection) => {
              if (!connection.available) unavailable = true;
              if (connection.loading) loading = true;
              return connection.available && !connection.loading;
            })
            .map((connection) =>
              workflowEnvironment.tiximWorkflowSearch({
                environmentId,
                input: { threadId, connectionId: connection.id, query: hid },
              }),
            );
          for (const query of queries) {
            const result = get(query);
            loading = loading || result.waiting || result._tag === "Initial";
            unavailable = unavailable || result._tag === "Failure";
            for (const run of AsyncResult.getOrElse(result, () => null)?.runs ?? []) {
              if (named(run) && !runs.some((other) => other.daemonId === run.daemonId))
                runs.push(run);
            }
          }
          return { runs, linked, loading, unavailable, queries };
        }),
      ),
    ),
  );
  return reference;
}
