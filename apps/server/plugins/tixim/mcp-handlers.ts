import {
  ThreadId,
  OrchestratorMcpFailure,
  TiximWorkflowRunDetails,
  type TiximWorkflowListResult,
  type TiximWorkflowRelationship,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Struct from "effect/Struct";
import { McpToolAccess, readThread, unavailable } from "../../src/plugins/host.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import * as TiximWorkflowWaits from "./TiximWorkflowWaits.ts";
import { toolkit } from "./mcp-tools.ts";

const required = <A>(value: A | undefined, name: string) =>
  value === undefined
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `This action needs \`${name}\`.`,
        }),
      )
    : Effect.succeed(value);
const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
  handle: (params: P) => Effect.Effect<A, E, R>,
) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

// Report text and step names are run output, which must not reach an agent as tool results.
const forAgent = (result: typeof TiximWorkflowListResult.Type) => ({
  ...result,
  runs: result.runs.map((run) => Struct.omit(run, Struct.keys(TiximWorkflowRunDetails))),
});

const workflowOperation = Effect.fn(function* (input: {
  threadId?: ThreadId | undefined;
  action: "list" | "search" | "attach" | "detach" | "poll";
  connectionId?: string | undefined;
  daemonId?: string | undefined;
  runId?: string | undefined;
  query?: string | undefined;
  mentionedOnly?: boolean | undefined;
  relationship?: TiximWorkflowRelationship | undefined;
}) {
  const { projection } = yield* readThread(input.threadId);
  const threadId = projection.thread.id;
  if (input.action === "poll") {
    const waits = yield* Effect.serviceOption(TiximWorkflowWaits.WorkflowWaits);
    if (Option.isNone(waits)) return yield* unavailable();
    return yield* waits.value.poll(threadId).pipe(Effect.mapError(unavailable));
  }
  const available = yield* Effect.serviceOption(TiximWorkflows.WorkflowOperations);
  if (Option.isNone(available)) return yield* unavailable();
  const workflows = available.value;
  if (input.action === "list")
    return yield* workflows.list(threadId).pipe(Effect.map(forAgent), Effect.mapError(unavailable));
  const connectionId = yield* required(input.connectionId, "connectionId");
  if (input.action === "search")
    return yield* workflows
      .search({
        threadId,
        connectionId,
        query: input.query ?? "",
        ...(input.mentionedOnly === undefined ? {} : { mentionedOnly: input.mentionedOnly }),
        includeHistory: input.query !== undefined && input.query.trim() !== "",
      })
      .pipe(Effect.map(forAgent), Effect.mapError(unavailable));
  return yield* workflows
    .link({
      threadId,
      connectionId,
      daemonId: yield* required(input.daemonId, "daemonId"),
      runId: yield* required(input.runId, "runId"),
      attach: input.action === "attach",
      ...(input.relationship === undefined ? {} : { relationship: input.relationship }),
    })
    .pipe(Effect.map(forAgent), Effect.mapError(unavailable));
});

export const layer = McpToolAccess.toLayer(toolkit, {
  t3_workflows_wait: writesThread((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      if (projection.thread.lineage.relationshipToParent === "subagent") {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "A delegated child cannot end its turn to wait: that reports completion to its parent. Have the parent attach these workflows and call t3_workflows_wait.",
        });
      }
      const available = yield* Effect.serviceOption(TiximWorkflowWaits.WorkflowWaits);
      if (Option.isNone(available)) return yield* unavailable();
      return yield* available.value
        .wait({ ...input, threadId: projection.thread.id })
        .pipe(Effect.mapError(unavailable));
    }),
  ),
  t3_thread_workflows: McpToolAccess.either(
    (input) => input.action === "list" || input.action === "search",
    McpToolAccess.reads(workflowOperation),
    writesThread(workflowOperation),
  ),
});
