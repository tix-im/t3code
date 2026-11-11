import type { TiximWorkflowRun } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { orderedRuns } from "./workflowPresentation";

const run = (runId: string, submittedAt: number, parentRunId = ""): TiximWorkflowRun => ({
  daemonId: "daemon",
  connectionId: "connection",
  runId,
  name: runId,
  state: "running",
  parentRunId,
  submittedAt,
  startedAt: null,
  finishedAt: null,
  attention: false,
  source: "manual",
  relationship: "tracking",
  availability: "available",
});

it("nests children under their parent with the rails that connect them", () => {
  const tree = orderedRuns([
    run("leaf", 2, "first"),
    run("second", 3, "root"),
    run("other-root", 5),
    run("first", 4, "root"),
    run("root", 10),
    run("cycle-a", 1, "cycle-b"),
    run("cycle-b", 0, "cycle-a"),
  ]).map(({ run, depth, rails, last, hasChildren }) => [
    run.runId,
    depth,
    rails,
    last,
    hasChildren,
  ]);
  expect(tree).toEqual([
    ["root", 0, [], true, true],
    ["first", 1, [], false, true],
    ["leaf", 2, [true], true, false],
    ["second", 1, [], true, false],
    ["other-root", 0, [], true, false],
    ["cycle-a", 0, [], true, true],
    ["cycle-b", 1, [], true, false],
  ]);
});
