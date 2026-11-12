import { expect, it } from "vite-plus/test";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import {
  EnvironmentId,
  ThreadId,
  type TiximWorkflowRun,
  type TiximWorkflowSearchInput,
} from "@t3tools/contracts";
import { createWorkflowReferenceFamily } from "./state.ts";

it("keeps identical HIDs from different daemons distinct and routes lookup to the selected environment", () => {
  const environmentId = EnvironmentId.make("remote");
  const threadId = ThreadId.make("thread");
  const hid = "wf-calm-river-a12b";
  const run = (daemonId: string): TiximWorkflowRun => ({
    daemonId,
    connectionId: daemonId,
    runId: hid,
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
  });
  const requests: Array<{ environmentId: EnvironmentId; input: TiximWorkflowSearchInput }> = [];
  const reference = createWorkflowReferenceFamily({
    tiximWorkflows: () =>
      Atom.make(
        AsyncResult.success({
          runs: [run("one")],
          connections: [
            { id: "one", label: "One", daemonId: "one", available: true },
            { id: "two", label: "Two", daemonId: "two", available: true },
            { id: "offline", label: "Offline", daemonId: "offline", available: false },
          ],
        }),
      ),
    tiximWorkflowSearch: (request) => {
      requests.push(request);
      return Atom.make(
        AsyncResult.success({
          runs: [run(request.input.connectionId), { ...run("wrong"), runId: "wf-other-run-1234" }],
          connections: [],
        }),
      );
    },
  });
  const registry = AtomRegistry.make();
  const atom = reference(environmentId)(threadId)(hid);
  expect(reference(environmentId)(threadId)(hid)).toBe(atom);
  const result = registry.get(atom);
  expect(result.runs.map((run) => run.daemonId)).toEqual(["one", "two"]);
  expect(result.linked.map((run) => run.daemonId)).toEqual(["one"]);
  expect(result.unavailable).toBe(true);
  expect(requests).toEqual(
    ["one", "two"].map((connectionId) => ({
      environmentId,
      input: { threadId, connectionId, query: hid },
    })),
  );
  requests.length = 0;
  registry.get(reference(environmentId)(threadId)(""));
  expect(requests).toEqual([]);
  registry.dispose();
});
